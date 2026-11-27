//! Import a Postman v2.1 collection: convert (Format), write, ONE commit, push.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::time::{SystemTime, UNIX_EPOCH};

use zenar_format::postman::{import_postman, updated_request, wrap_in_folder, write_import, PostmanImport};
use zenar_format::postman_export::export_postman;
use zenar_format::{open_collection, slugify, CollectionData, RequestItem};

use crate::{Change, CollectionService, FolderOp, Plan, Pushed, ServiceError, TreeChange};

#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct ImportReport {
    /// Number of Requests imported.
    pub requests: usize,
    /// Re-import of this Collection's own export: how many existing Requests the file changed.
    pub updated: usize,
    #[ts(type = "string | null")]
    pub commit: Option<String>,
    /// Things Postman has that Zenar cannot hold (skipped, not fatal).
    pub warnings: Vec<String>,
}

/// Random 128-bit hex id (no extra dependency; std's per-process random hasher keys + time + counter).
pub fn id_generator() -> impl FnMut() -> String {
    let state = RandomState::new();
    let mut n: u64 = 0;
    move || {
        n += 1;
        let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let mut h1 = state.build_hasher();
        h1.write_u64(n);
        h1.write_u128(t);
        let mut h2 = state.build_hasher();
        h2.write_u128(t);
        h2.write_u64(n.rotate_left(17));
        format!("{:016x}{:016x}", h1.finish(), h2.finish())
    }
}

impl CollectionService<'_> {
    /// Import `json` (a Postman v2.1 collection) into this Collection as a single commit
    /// "Import N request(s) from Postman", then push (re-fetching and retrying when rejected).
    /// Everything lands in one new top-level Folder named after the Postman collection, last in the tree,
    /// except a re-import of this Collection's own export: that updates its Requests in place (`reimport`).
    pub fn import_postman(&self, json: &str) -> Result<ImportReport, ServiceError> {
        let imp = import_postman(json, &mut id_generator()).map_err(|e| ServiceError::Import(e.to_string()))?;
        let n = imp.requests.len();
        let message = format!("Import {n} request{} from Postman", if n == 1 { "" } else { "s" });
        let report = |commit| ImportReport { requests: n, updated: 0, commit, warnings: imp.warnings.clone() };

        let pushed = self.commit_push(None, || {
            let data = open_collection(&self.root)?;
            if is_reimport(&imp, &data) {
                return self.reimport(&imp, &data, &message, report(None));
            }
            // Fresh after each fetch: a new directory (never merged into an existing one), ordered last.
            let base = match slugify(&imp.name) {
                s if s.is_empty() => "postman-import".to_string(),
                s => s,
            };
            let mut slug = base.clone();
            let mut k = 2;
            while self.root.join(&slug).exists() {
                slug = format!("{base}-{k}");
                k += 1;
            }
            let last = data
                .folders
                .iter()
                .filter(|f| !f.path.contains('/'))
                .map(|f| f.order)
                .chain(data.requests.iter().filter(|r| r.folder.is_empty()).map(|r| r.order))
                .fold(0.0, f64::max);
            let paths = write_import(&self.root, &wrap_in_folder(&imp, &slug, last + 1.0))?;
            Ok(Plan::Write { message: message.clone(), paths, request: report(None) })
        });
        self.track_access(
            pushed.map(|p| match p {
                Pushed::Saved { commit, value } => ImportReport { commit, ..value },
                Pushed::Conflict(_) => report(None),
            }),
            |r| r.commit.is_some(),
        )
    }

    /// The file is this Collection's own export: Requests and Folders it has (same id) are updated in
    /// place, the others are created where the file puts them, nothing is deleted. No wrapping Folder.
    fn reimport(&self, imp: &PostmanImport, data: &CollectionData, message: &str, report: ImportReport) -> Result<Plan<ImportReport>, ServiceError> {
        let mut new_id = id_generator();
        let here = |id: &str| imp.source_ids.get(id).map(String::as_str);
        let mut changes = Vec::new();

        // Each imported Folder path -> its id here, and its path when it already existed (for orders).
        let mut place: HashMap<&str, (Option<String>, Option<String>)> = HashMap::from([("", (None, Some(String::new())))]);
        for f in &imp.folders {
            let parent = place.get(parent_of(&f.path)).cloned().unwrap_or((None, None));
            match here(&f.id).and_then(|s| data.folders.iter().find(|x| x.id == s)) {
                Some(ex) => {
                    if ex.name != f.name {
                        changes.push(TreeChange::Folder { op: FolderOp::Rename { id: ex.id.clone(), name: f.name.clone() } });
                    }
                    place.insert(&f.path, (Some(ex.id.clone()), Some(ex.path.clone())));
                }
                None => {
                    let id = new_id();
                    let order = last_order(data, parent.1.as_deref()) + f.order;
                    changes.push(TreeChange::Folder { op: FolderOp::Create { id: id.clone(), name: f.name.clone(), parent_id: parent.0, order } });
                    place.insert(&f.path, (Some(id), None));
                }
            }
        }

        // Each Request here as an export brings it back: what "unchanged in the file" looks like.
        let exported = import_postman(&export_postman(data).json, &mut id_generator()).map_err(|e| ServiceError::Import(e.to_string()))?;
        let exported: HashMap<&str, &RequestItem> =
            exported.requests.iter().filter_map(|r| exported.source_ids.get(&r.id).map(|s| (s.as_str(), r))).collect();

        let (mut updated, mut created) = (0, 0);
        for r in &imp.requests {
            match here(&r.id).and_then(|s| data.requests.iter().find(|x| x.id == s)) {
                Some(ours) => {
                    let Some(e) = exported.get(ours.id.as_str()) else { continue };
                    let new = updated_request(ours, e, r);
                    if new != *ours {
                        updated += 1;
                        changes.push(TreeChange::Request { change: Change::Update { base: ours.clone(), ours: new }, folder_id: None });
                    }
                }
                None => {
                    created += 1;
                    let (folder_id, path) = place.get(r.folder.as_str()).cloned().unwrap_or((None, None));
                    let order = last_order(data, path.as_deref()) + r.order;
                    changes.push(TreeChange::Request { change: Change::Create(RequestItem { order, ..r.clone() }), folder_id });
                }
            }
        }

        let (paths, _, batch) = self.plan_batch(&changes)?;
        let mut report = ImportReport { updated, ..report };
        for c in &batch.conflicts {
            report.warnings.push(format!("change {} was left out: someone else changed it meanwhile", c.index + 1));
        }
        if paths.is_empty() {
            return Ok(Plan::Nothing(report));
        }
        let message = format!("{message} ({updated} updated, {created} new)");
        Ok(Plan::Write { message, paths, request: report })
    }
}

/// A Request in the file came from this Collection (a Zenar export carries its ids).
fn is_reimport(imp: &PostmanImport, data: &CollectionData) -> bool {
    imp.requests.iter().any(|r| imp.source_ids.get(&r.id).is_some_and(|s| data.requests.iter().any(|x| &x.id == s)))
}

fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(p, _)| p)
}

/// Highest order among the Folders and Requests directly in the existing Folder at `path` (0 for a new one).
fn last_order(data: &CollectionData, path: Option<&str>) -> f64 {
    let Some(p) = path else { return 0.0 };
    data.folders
        .iter()
        .filter(|f| parent_of(&f.path) == p)
        .map(|f| f.order)
        .chain(data.requests.iter().filter(|r| r.folder == p).map(|r| r.order))
        .fold(0.0, f64::max)
}
