//! Collection service (ADR 0001, 0002): Save = fetch, merge by Field, write, one commit per
//! Request, push (retrying on rejection); every other shared write (Folder ops, Environments,
//! Collection and Folder defaults, import) uses the same `commit_push`. `sync` is the background
//! fetch (not a user action: the user only ever Saves): it applies remote changes silently,
//! except to Requests that have a Draft.
//!
//! Invariant: between calls the clone equals the remote tip (no unpushed commits). A Save that
//! cannot be pushed is rolled back to the remote tip and the change stays a Draft.

mod batch;
mod conflict;
mod environment;
mod import;
mod offline;
mod store;
mod tree;

pub use environment::{Defaults, SharedSave};
pub use import::{id_generator, ImportReport};

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use zenar_format::{canonical_request_yaml, create_request, open_collection, CollectionData, RequestItem};
use zenar_git::{GitOutput, GitRunner, RunError};
use zenar_merge::{merge, Conflict, ConflictKind};

pub use batch::{BatchConflict, BatchResult, TreeChange};
pub use conflict::ConflictInfo;
pub use offline::{AttemptResult, AttentionItem, DrainReport, DraftReason, OfflineStatus, SaveAttempt};
pub use store::{Draft, DraftStore};
pub use tree::FolderOp;

/// How many times Save re-fetches and re-merges when the push is rejected.
const PUSH_ATTEMPTS: usize = 5;

#[derive(Debug, thiserror::Error)]
pub enum ServiceError {
    #[error("git error: {0}")]
    Git(String),
    #[error("Could not push your Save (you may only have read access, or you are offline). Your change is kept as a Draft. Details: {0}")]
    PushFailed(String),
    #[error("Cannot reach the Collection's host (you may be offline). Nothing was shared yet. Details: {0}")]
    Offline(String),
    #[error("The Collection's default branch is protected, so the host rejected your Save. Your change is kept as a Draft. Ask a maintainer to allow pushes to it. Details: {0}")]
    ProtectedBranch(String),
    #[error("You do not have write access to this Collection, so you are a Viewer on this machine: you can open and run Requests, but Saves stay Drafts. Ask a maintainer for write access. Details: {0}")]
    NoWriteAccess(String),
    #[error("The Collection's host rejected your sign-in (your access token may have expired). Sign in again, then Save again. Your change is kept as a Draft. Details: {0}")]
    AuthFailed(String),
    #[error("Could not keep up with other Members' Saves; try again. Your change is kept as a Draft.")]
    PushRaced,
    #[error("Request not found: {0}")]
    NotFound(String),
    #[error("collection error: {0}")]
    Format(#[from] zenar_format::OpenError),
    #[error("{0}")]
    Tree(String),
    #[error("Import failed: {0}")]
    Import(String),
    #[error("draft store error: {0}")]
    Store(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<RunError> for ServiceError {
    fn from(e: RunError) -> Self {
        ServiceError::Git(e.to_string())
    }
}

/// One Save of one Request. `base` is the version the user started editing (last fetched).
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Change {
    Create(RequestItem),
    Update { base: RequestItem, ours: RequestItem },
    Delete { base: RequestItem },
}

impl Change {
    pub(crate) fn id(&self) -> &str {
        match self {
            Change::Create(r) => &r.id,
            Change::Update { ours, .. } => &ours.id,
            Change::Delete { base } => &base.id,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SaveOutcome {
    /// `commit` is `None` when the merged result equals what the remote already has.
    /// `request` is the merged Request (the new base); `None` after a Delete.
    Saved { commit: Option<String>, request: Option<RequestItem> },
    /// Another Member changed the same Field(s), or deleted/moved the Request.
    /// Nothing was written; `theirs` is the remote version (`None` when deleted).
    Conflict { conflicts: Vec<Conflict>, theirs: Option<RequestItem> },
}

/// A Draft whose Request was changed on the remote since the Draft's base.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct DraftAlert {
    pub request_id: String,
    /// Who made the latest remote change ("A vừa sửa Request này").
    pub author: Option<String>,
}

#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct SyncReport {
    pub data: CollectionData,
    /// Ids of Requests that were added, changed or removed remotely and applied silently.
    pub applied: Vec<String>,
    /// Drafts that were left untouched although the remote changed that Request.
    pub draft_alerts: Vec<DraftAlert>,
}

pub struct CollectionService<'g> {
    git: &'g dyn GitRunner,
    root: PathBuf,
    drafts: DraftStore,
}

impl<'g> CollectionService<'g> {
    /// `root` is the clone; `store_dir` holds local-only state (Drafts) and must be outside the repo.
    pub fn new(git: &'g dyn GitRunner, root: &Path, store_dir: &Path) -> Self {
        CollectionService { git, root: root.to_path_buf(), drafts: DraftStore::new(store_dir) }
    }

    pub fn drafts(&self) -> &DraftStore {
        &self.drafts
    }

    fn git(&self, args: &[&str]) -> Result<GitOutput, ServiceError> {
        Ok(self.git.run(Some(&self.root), args)?)
    }

    fn git_ok(&self, args: &[&str]) -> Result<String, ServiceError> {
        let o = self.git(args)?;
        if o.success {
            Ok(o.stdout)
        } else {
            Err(ServiceError::Git(o.stderr.trim().to_string()))
        }
    }

    /// Fetch and move the clone to the remote tip. Returns the tip's commit id.
    fn fetch_reset(&self) -> Result<String, ServiceError> {
        let branch = self.git_ok(&["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string();
        let fetch = self.git(&["fetch", "--quiet", "origin", &branch])?;
        if !fetch.success {
            return Err(offline::classify(&fetch.stderr).unwrap_or_else(|| ServiceError::Git(fetch.stderr.trim().to_string())));
        }
        self.git_ok(&["reset", "--hard", "--quiet", "FETCH_HEAD"])?;
        Ok(self.git_ok(&["rev-parse", "HEAD"])?.trim().to_string())
    }

    /// Auto-pull (open, focus, every minute): apply remote changes silently, never replace a Draft.
    pub fn sync(&self) -> Result<SyncReport, ServiceError> {
        let before = request_snapshot(&open_collection(&self.root)?);
        self.fetch_reset()?;
        let data = open_collection(&self.root)?;
        let after = request_snapshot(&data);

        let mut drafts = self.drafts.load()?;
        let mut applied = Vec::new();
        let mut alerts = Vec::new();
        let ids: Vec<&String> = before.keys().chain(after.keys().filter(|k| !before.contains_key(*k))).collect();
        for id in ids {
            if before.get(id) == after.get(id) {
                continue;
            }
            if drafts.iter().any(|d| &d.request_id == id) {
                continue; // handled below
            }
            applied.push(id.clone());
        }
        for d in drafts.iter_mut() {
            let theirs = data.requests.iter().find(|r| r.id == d.request_id);
            let changed = match (&d.base, theirs) {
                (Some(b), Some(t)) => snapshot_of(b) != snapshot_of(t),
                (Some(_), None) => true,
                (None, _) => false,
            };
            d.remote_changed = changed;
            if changed {
                let path = d.base.as_ref().map(|b| b.path.clone()).unwrap_or_default();
                let path = theirs.map(|t| t.path.clone()).unwrap_or(path);
                let author = self
                    .git_ok(&["log", "-1", "--format=%an", "--", &path])
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                alerts.push(DraftAlert { request_id: d.request_id.clone(), author });
            }
        }
        self.drafts.store(&drafts)?;
        applied.sort();
        Ok(SyncReport { data, applied, draft_alerts: alerts })
    }

    /// Save one Request: fetch, merge by Field with the remote, write, commit, push.
    pub fn save(&self, change: Change) -> Result<SaveOutcome, ServiceError> {
        self.save_in(change, None)
    }

    /// Like [`save`], for a Request created in / moved into the Folder `folder_id`. The Folder is
    /// found by id on the remote tip, so a Folder renamed or moved by someone else is followed;
    /// a Folder deleted by someone else is a Conflict (`folders/<id>`).
    pub fn save_in(&self, change: Change, folder_id: Option<&str>) -> Result<SaveOutcome, ServiceError> {
        let id = change.id().to_string();
        self.commit_loop(Some(&id), || {
            let change = match self.resolve_folder(&change, folder_id)? {
                Ok(c) => c,
                Err(o) => return Ok(Plan::Conflict(o)),
            };
            self.plan(&change)
        })
    }

    /// Folder operation (create, rename, move, reorder, delete) with the same fetch, commit, push
    /// and retry as Save. See [`FolderOp`].
    pub fn folder_op(&self, op: FolderOp) -> Result<SaveOutcome, ServiceError> {
        let r = self.commit_loop(None, || tree::plan(&self.root, &op));
        self.track_access(r, |o| matches!(o, SaveOutcome::Saved { commit: Some(_), .. }))
    }

    fn resolve_folder(&self, change: &Change, folder_id: Option<&str>) -> Result<Result<Change, SaveOutcome>, ServiceError> {
        let Some(fid) = folder_id else { return Ok(Ok(change.clone())) };
        let data = open_collection(&self.root)?;
        let Some(f) = data.folders.iter().find(|f| f.id == fid) else {
            let theirs = data.requests.iter().find(|r| r.id == change.id()).cloned();
            return Ok(Err(SaveOutcome::Conflict {
                conflicts: vec![Conflict { field: format!("folders/{fid}"), kind: ConflictKind::EditVsDelete }],
                theirs,
            }));
        };
        Ok(Ok(match change {
            Change::Create(r) => Change::Create(RequestItem { folder: f.path.clone(), ..r.clone() }),
            Change::Update { base, ours } if ours.folder != base.folder => {
                Change::Update { base: base.clone(), ours: RequestItem { folder: f.path.clone(), ..ours.clone() } }
            }
            c => c.clone(),
        }))
    }

    /// `plan` against the remote tip, then commit and push; the one place that knows about
    /// retrying a rejected push and about offline / protected-branch / no-access / sign-in failures.
    /// Every shared write (Request Save, Folder op, Environment, defaults, import) goes through it.
    pub(crate) fn commit_push<T>(&self, draft_id: Option<&str>, plan: impl Fn() -> Result<Plan<T>, ServiceError>) -> Result<Pushed<T>, ServiceError> {
        let resolved = |this: &Self| {
            if let Some(id) = draft_id {
                let _ = this.drafts.remove(id);
                this.attention_resolved(id);
            }
        };
        for _ in 0..PUSH_ATTEMPTS {
            let tip = self.fetch_reset()?;
            let (message, paths, value) = match plan()? {
                Plan::Conflict(o) => return Ok(Pushed::Conflict(o)),
                Plan::Nothing(value) => {
                    resolved(self);
                    return Ok(Pushed::Saved { commit: None, value });
                }
                Plan::Write { message, paths, request } => (message, paths, request),
            };
            let mut add = vec!["add", "-A", "--"];
            add.extend(paths.iter().map(String::as_str));
            self.git_ok(&add)?;
            if self.git(&["diff", "--cached", "--quiet"])?.success {
                resolved(self); // the remote already has exactly this
                return Ok(Pushed::Saved { commit: None, value });
            }
            self.git_ok(&["commit", "--quiet", "-m", &message])?;
            let commit = self.git_ok(&["rev-parse", "HEAD"])?.trim().to_string();
            let push = self.git(&["push", "--quiet", "origin", "HEAD"])?;
            if push.success {
                resolved(self);
                return Ok(Pushed::Saved { commit: Some(commit), value });
            }
            // Offline / protected branch / no write access / bad credentials: restore the clone to
            // the remote tip (no network needed) so it keeps equalling it, and report the reason.
            if let Some(e) = offline::classify(&push.stderr) {
                self.git_ok(&["reset", "--hard", "--quiet", &tip])?;
                return Err(e);
            }
            // Rejected because someone pushed first? Then the remote tip moved: retry. Otherwise give up.
            let moved = self.fetch_reset().map(|t| t != commit && t != tip).unwrap_or(false);
            if !moved {
                let _ = self.fetch_reset();
                return Err(ServiceError::PushFailed(push.stderr.trim().to_string()));
            }
        }
        let _ = self.fetch_reset();
        Err(ServiceError::PushRaced)
    }

    /// Fetch, `plan_fn` against the remote tip, commit, push; retry when the push is rejected.
    pub(crate) fn commit_and_push(&self, change: &Change, plan_fn: impl Fn(&Self) -> Result<Plan, ServiceError>) -> Result<SaveOutcome, ServiceError> {
        self.commit_loop(Some(change.id()), || plan_fn(self))
    }

    fn commit_loop(&self, draft_id: Option<&str>, plan: impl Fn() -> Result<Plan, ServiceError>) -> Result<SaveOutcome, ServiceError> {
        Ok(match self.commit_push(draft_id, plan)? {
            Pushed::Saved { commit, value } => SaveOutcome::Saved { commit, request: value },
            Pushed::Conflict(o) => o,
        })
    }

    /// Merge `change` against the remote working tree and write the files. Does not commit.
    fn plan(&self, change: &Change) -> Result<Plan, ServiceError> {
        let data = open_collection(&self.root)?;
        let theirs = data.requests.iter().find(|r| r.id == change.id()).cloned();
        match change {
            Change::Create(item) => {
                let rel = create_request(&self.root, item)?;
                let mut saved = item.clone();
                saved.path = rel.clone();
                Ok(Plan::Write { message: message("Create", &saved), paths: vec![rel], request: Some(saved) })
            }
            Change::Update { base, ours } => {
                let Some(theirs) = theirs else {
                    return Ok(Plan::Conflict(SaveOutcome::Conflict {
                        conflicts: vec![Conflict { field: format!("requests/{}", ours.id), kind: ConflictKind::EditVsDelete }],
                        theirs: None,
                    }));
                };
                let merged = match merge(base, ours, &theirs) {
                    Ok(m) => m,
                    Err(conflicts) => return Ok(Plan::Conflict(SaveOutcome::Conflict { conflicts, theirs: Some(theirs) })),
                };
                self.write_merged(base, ours, merged, theirs)
            }
            Change::Delete { base } => {
                let Some(theirs) = theirs else { return Ok(Plan::Nothing(None)) };
                if snapshot_of(base) != snapshot_of(&theirs) {
                    return Ok(Plan::Conflict(SaveOutcome::Conflict {
                        conflicts: vec![Conflict { field: format!("requests/{}", base.id), kind: ConflictKind::EditVsDelete }],
                        theirs: Some(theirs),
                    }));
                }
                fs::remove_file(self.root.join(&theirs.path))?;
                Ok(Plan::Write { message: message("Delete", &theirs), paths: vec![theirs.path], request: None })
            }
        }
    }

    fn write_merged(&self, base: &RequestItem, ours: &RequestItem, mut merged: RequestItem, theirs: RequestItem) -> Result<Plan, ServiceError> {
        if snapshot_of(&merged) == snapshot_of(&theirs) {
            merged.path = theirs.path;
            return Ok(Plan::Nothing(Some(ours.clone())));
        }
        let verb = if ours.folder != base.folder {
            "Move"
        } else if ours.name != base.name {
            "Rename"
        } else {
            "Update"
        };
        let mut paths = vec![theirs.path.clone()];
        // The file path is recomputed from the merged name + folder, not taken from either side.
        if merged.name == theirs.name && merged.folder == theirs.folder {
            merged.path = theirs.path.clone();
            fs::write(self.root.join(&merged.path), canonical_request_yaml(&merged)?)?;
        } else {
            fs::remove_file(self.root.join(&theirs.path))?;
            merged.path = create_request(&self.root, &merged)?;
            paths.push(merged.path.clone());
        }
        Ok(Plan::Write { message: message(verb, &merged), paths, request: Some(merged) })
    }
}

/// What to write for one shared change. `T` is what the caller gets back (a Request, a report, ...).
pub(crate) enum Plan<T = Option<RequestItem>> {
    Write { message: String, paths: Vec<String>, request: T },
    /// The remote already has the intended result.
    Nothing(T),
    Conflict(SaveOutcome),
}

pub(crate) enum Pushed<T> {
    Saved { commit: Option<String>, value: T },
    Conflict(SaveOutcome),
}

/// `Verb "name" (folder/)`; the folder part is omitted for Requests at the root.
fn message(verb: &str, r: &RequestItem) -> String {
    if r.folder.is_empty() {
        format!("{verb} \"{}\"", r.name)
    } else {
        format!("{verb} \"{}\" ({}/)", r.name, r.folder)
    }
}

/// Content identity of a Request, ignoring the derived `path`.
fn snapshot_of(r: &RequestItem) -> String {
    format!("{}\n{}", r.folder, canonical_request_yaml(r).unwrap_or_default())
}

fn request_snapshot(d: &CollectionData) -> HashMap<String, String> {
    d.requests.iter().map(|r| (r.id.clone(), snapshot_of(r))).collect()
}

/// UI-facing result of [`CollectionService::save`] (serializable; types exported to TypeScript).
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SaveResult {
    Saved { request: Option<RequestItem> },
    /// `fields` are the conflicting Field paths (e.g. `url`, `headers/<id>`, `requests/<id>`).
    Conflict { fields: Vec<String>, theirs: Option<RequestItem> },
}

impl From<SaveOutcome> for SaveResult {
    fn from(o: SaveOutcome) -> Self {
        match o {
            SaveOutcome::Saved { request, .. } => SaveResult::Saved { request },
            SaveOutcome::Conflict { conflicts, theirs } => {
                SaveResult::Conflict { fields: conflicts.into_iter().map(|c| c.field).collect(), theirs }
            }
        }
    }
}
