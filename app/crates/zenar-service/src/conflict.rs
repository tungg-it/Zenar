//! Conflict resolution (ADR 0002): after `save` reports a Conflict the user picks
//! Overwrite (new commit on top of remote, ours wins only on conflicting Fields, never a force
//! push) or Cancel (take remote, my changes become a Draft). History is never rewritten.

use std::fs;

use zenar_format::{create_request, RequestItem};
use zenar_merge::{merge, overwrite};

use crate::{message, Change, CollectionService, Draft, Plan, SaveOutcome, ServiceError};

/// What the Conflict UI shows next to my version: the remote version, who wrote it and when.
#[derive(Debug, Clone, PartialEq, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct ConflictInfo {
    /// Remote version; `None` when the Request was deleted remotely.
    pub theirs: Option<RequestItem>,
    pub theirs_author: Option<String>,
    /// Author date of the latest remote commit touching the Request (ISO 8601).
    pub theirs_time: Option<String>,
    /// Conflicting Field paths (e.g. `url`, `headers/<id>`, `requests/<id>`).
    pub fields: Vec<String>,
}

impl CollectionService<'_> {
    fn last_author(&self, path: &str) -> (Option<String>, Option<String>) {
        let one = |fmt: &str| {
            self.git_ok(&["log", "-1", fmt, "--", path]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        };
        (one("--format=%an"), one("--format=%aI"))
    }

    /// Fetch the remote tip and describe the Conflict for `change` (the clone moves to the tip).
    pub fn conflict_info(&self, change: &Change) -> Result<ConflictInfo, ServiceError> {
        self.fetch_reset()?;
        let data = zenar_format::open_collection(&self.root)?;
        let theirs = data.requests.iter().find(|r| r.id == change.id()).cloned();
        let path = theirs.as_ref().map(|t| t.path.clone()).or_else(|| match change {
            Change::Update { base, .. } | Change::Delete { base } => Some(base.path.clone()),
            Change::Create(r) => Some(r.path.clone()),
        });
        let (theirs_author, theirs_time) = path.map(|p| self.last_author(&p)).unwrap_or((None, None));
        let fields = match (change, &theirs) {
            (Change::Update { base, ours }, Some(t)) => {
                merge(base, ours, t).err().unwrap_or_default().into_iter().map(|c| c.field).collect()
            }
            (c, _) => vec![format!("requests/{}", c.id())],
        };
        Ok(ConflictInfo { theirs, theirs_author, theirs_time, fields })
    }

    /// Overwrite: conflicting Fields take mine, every other remote change is kept; one new commit
    /// `Overwrite "name" over changes by <author>` on top of the remote tip, pushed normally.
    pub fn overwrite(&self, change: Change) -> Result<SaveOutcome, ServiceError> {
        self.commit_and_push(&change, |s| s.plan_overwrite(&change))
    }

    fn plan_overwrite(&self, change: &Change) -> Result<Plan, ServiceError> {
        let data = zenar_format::open_collection(&self.root)?;
        let theirs = data.requests.iter().find(|r| r.id == change.id()).cloned();
        let by = |path: &str| format!(" over changes by {}", self.last_author(path).0.unwrap_or_else(|| "another Member".into()));
        let plan = match (change, theirs) {
            (Change::Create(_), _) => return self.plan(change),
            (Change::Delete { .. }, None) => Plan::Nothing(None),
            (Change::Delete { .. }, Some(t)) => {
                fs::remove_file(self.root.join(&t.path))?;
                Plan::Write { message: message("Delete", &t) + &by(&t.path), paths: vec![t.path], request: None }
            }
            (Change::Update { base, ours }, None) => {
                // Remote deleted it: mine wins, the Request comes back.
                let rel = create_request(&self.root, ours)?;
                let mut saved = ours.clone();
                saved.path = rel.clone();
                Plan::Write { message: message("Overwrite", &saved) + &by(&base.path), paths: vec![rel], request: Some(saved) }
            }
            (Change::Update { base, ours }, Some(theirs)) => {
                let merged = overwrite(base, ours, &theirs);
                let by = by(&theirs.path);
                match self.write_merged(base, ours, merged, theirs)? {
                    Plan::Write { request: Some(r), paths, .. } => {
                        Plan::Write { message: message("Overwrite", &r) + &by, paths, request: Some(r) }
                    }
                    other => other,
                }
            }
        };
        Ok(plan)
    }

    /// Cancel: take the remote (clone = remote tip) and keep my changes as a Draft whose base is the
    /// remote version, so it is no longer stale. Nothing is committed or pushed.
    /// Returns `None` when there is nothing to keep (a cancelled Delete).
    pub fn cancel(&self, change: &Change) -> Result<Option<Draft>, ServiceError> {
        self.fetch_reset()?;
        self.attention_resolved(change.id());
        let Change::Update { ours, .. } = change else { return Ok(None) };
        let data = zenar_format::open_collection(&self.root)?;
        let base = data.requests.into_iter().find(|r| r.id == ours.id);
        let draft = Draft { request_id: ours.id.clone(), base, draft: ours.clone(), remote_changed: false };
        let mut all = self.drafts.load()?;
        all.retain(|d| d.request_id != draft.request_id);
        all.push(draft.clone());
        self.drafts.store(&all)?;
        self.attention_resolved(&draft.request_id);
        Ok(Some(draft))
    }
}
