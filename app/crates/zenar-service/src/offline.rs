//! Offline queue and permission states (ADR 0007).
//!
//! Design: a Save that cannot reach the remote is queued as a [`Change`] in the local store
//! (`queue.yaml`, outside the repo), never as a local commit, so the service invariant "between
//! calls the clone equals the remote tip" still holds. The Request also stays a Draft while queued
//! (it is unshared work). [`CollectionService::drain_queue`] replays the queue through the normal
//! `save`; Conflicts found then go to Needs Attention (`attention.yaml`) instead of a popup.
//!
//! Permissions are only discovered when the host rejects a push: a protected default branch keeps
//! the Draft and says why; no write access additionally marks the Collection a Viewer on this
//! machine (`viewer` marker file). Viewers can still sync and run Requests; Saves stay Drafts. Every
//! Save still attempts a push, so regained access heals the Viewer mark by itself.

use std::fs;
use std::path::PathBuf;

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{Change, CollectionService, SaveOutcome, ServiceError};

/// Map git's stderr to a typed failure. `None` means "some other error" (e.g. a lost race).
///
/// Credentials that were rejected (expired token, 401) are checked first and are neither "offline"
/// nor "Viewer": the person has to sign in again. Only genuine no-write-access messages mark a
/// Viewer; a bare HTTP 403 or "access denied" is ambiguous (expired tokens produce them too).
pub(crate) fn classify(stderr: &str) -> Option<ServiceError> {
    let detail = stderr.trim().to_string();
    let s = detail.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| s.contains(n));
    if has(&[
        "authentication failed",
        "returned error: 401",
        "invalid username or password",
        "bad credentials",
        "could not read username",
        "could not read password",
        "terminal prompts disabled",
        "permission denied (publickey",
    ]) {
        Some(ServiceError::AuthFailed(detail))
    } else if has(&["protected branch"]) {
        Some(ServiceError::ProtectedBranch(detail))
    } else if has(&["permission to", "not allowed to push", "write access"]) {
        Some(ServiceError::NoWriteAccess(detail))
    } else if has(&[
        "could not resolve host",
        "failed to connect",
        "connection refused",
        "connection reset",
        "timed out",
        "network is unreachable",
        "no route to host",
        "name or service not known",
        "does not appear to be a git repository",
        "could not read from remote",
    ]) {
        Some(ServiceError::Offline(detail))
    } else {
        None
    }
}

#[cfg(test)]
mod classify_tests {
    use super::*;

    #[test]
    fn expired_credentials_are_auth_failed_not_offline_or_viewer() {
        for msg in [
            "fatal: Authentication failed for 'https://github.com/a/b.git/'",
            "fatal: unable to access 'https://x/r.git/': The requested URL returned error: 401",
            "remote: Invalid username or password.\nfatal: Authentication failed",
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        ] {
            assert!(matches!(classify(msg), Some(ServiceError::AuthFailed(_))), "{msg}");
        }
    }

    #[test]
    fn a_bare_403_or_access_denied_is_not_proof_of_read_only() {
        for msg in ["fatal: unable to access 'https://x/r.git/': The requested URL returned error: 403", "Access denied"] {
            assert!(classify(msg).is_none(), "{msg}");
        }
    }

    #[test]
    fn genuine_signals_still_classify() {
        assert!(matches!(classify("remote: Permission to a/b.git denied to bob."), Some(ServiceError::NoWriteAccess(_))));
        assert!(matches!(classify("remote: You are not allowed to push code to protected branches"), Some(ServiceError::ProtectedBranch(_))));
        assert!(matches!(classify("fatal: unable to access 'https://x/': Could not resolve host: x"), Some(ServiceError::Offline(_))));
    }
}

/// Why a Save was kept as a Draft instead of being shared.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
#[serde(tag = "reason", rename_all = "snake_case")]
pub enum DraftReason {
    ProtectedBranch { message: String },
    /// The host rejected this person's credentials (expired token): sign in again, then Save again.
    AuthFailed { message: String },
    /// `first_rejection`: this rejection just marked the Collection a Viewer (tell the user once).
    NoWriteAccess { message: String, first_rejection: bool },
}

#[derive(Debug, Clone)]
pub enum SaveAttempt {
    Saved(SaveOutcome),
    /// Remote unreachable: queued, will be pushed by `drain_queue`.
    Queued,
    Draft(DraftReason),
}

/// UI-facing result of [`CollectionService::save_or_queue`].
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AttemptResult {
    Saved { request: Option<zenar_format::RequestItem> },
    Conflict { fields: Vec<String>, theirs: Option<zenar_format::RequestItem> },
    Queued,
    Draft { reason: DraftReason },
}

impl From<SaveAttempt> for AttemptResult {
    fn from(a: SaveAttempt) -> Self {
        match a {
            SaveAttempt::Saved(o) => match crate::SaveResult::from(o) {
                crate::SaveResult::Saved { request } => AttemptResult::Saved { request },
                crate::SaveResult::Conflict { fields, theirs } => AttemptResult::Conflict { fields, theirs },
            },
            SaveAttempt::Queued => AttemptResult::Queued,
            SaveAttempt::Draft(reason) => AttemptResult::Draft { reason },
        }
    }
}

/// A queued Save that hit a Conflict when pushed later: listed under Needs Attention.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct AttentionItem {
    pub request_id: String,
    pub name: String,
    /// The Save to resolve with Overwrite or Cancel (conflict_info / overwrite / cancel).
    pub change: Change,
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct DrainReport {
    /// Ids whose queued Save was pushed.
    pub saved: Vec<String>,
    /// Conflicts found by this drain (all of them are also in `needs_attention()`).
    pub needs_attention: Vec<AttentionItem>,
    /// Still unreachable: the rest of the queue was kept.
    pub offline: bool,
    /// The host rejected the push (protected branch / no write access): queue emptied, Drafts kept.
    pub stopped: Option<DraftReason>,
}

/// Local state shown by the UI: what is waiting, what needs a decision, whether this is a Viewer.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct OfflineStatus {
    pub queued: Vec<String>,
    pub needs_attention: Vec<AttentionItem>,
    pub viewer: bool,
}

/// A queued Save with the Folder it was saved into (by id, so a renamed Folder is followed).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Queued {
    change: Change,
    #[serde(default)]
    folder_id: Option<String>,
}

fn change_name(c: &Change) -> String {
    match c {
        Change::Create(r) => r.name.clone(),
        Change::Update { ours, .. } => ours.name.clone(),
        Change::Delete { base } => base.name.clone(),
    }
}

/// Fold a newer Save of the same Request into the queued one, keeping the oldest base so the
/// replay never conflicts with itself. `None` = they cancel out (created then deleted offline).
fn coalesce(old: Change, new: Change) -> Option<Change> {
    match (old, new) {
        (Change::Create(_), Change::Create(r)) | (Change::Create(_), Change::Update { ours: r, .. }) => Some(Change::Create(r)),
        (Change::Create(_), Change::Delete { .. }) => None,
        (Change::Update { base, .. }, Change::Update { ours, .. }) => Some(Change::Update { base, ours }),
        (Change::Update { base, .. }, Change::Delete { .. }) => Some(Change::Delete { base }),
        (_, new) => Some(new),
    }
}

impl CollectionService<'_> {
    fn state_file(&self, name: &str) -> PathBuf {
        self.drafts.dir().join(name)
    }

    fn load_list<T: DeserializeOwned>(&self, name: &str) -> Result<Vec<T>, ServiceError> {
        let f = self.state_file(name);
        if !f.is_file() {
            return Ok(vec![]);
        }
        serde_yaml::from_str(&fs::read_to_string(f)?).map_err(|e| ServiceError::Store(e.to_string()))
    }

    fn store_list<T: Serialize>(&self, name: &str, items: &[T]) -> Result<(), ServiceError> {
        fs::create_dir_all(self.drafts.dir())?;
        let text = serde_yaml::to_string(items).map_err(|e| ServiceError::Store(e.to_string()))?;
        let f = self.state_file(name);
        let tmp = f.with_extension("yaml.tmp");
        fs::write(&tmp, text)?;
        fs::rename(&tmp, &f)?;
        Ok(())
    }

    /// Ids of Requests with a Save waiting for the remote to come back.
    pub fn queued_ids(&self) -> Result<Vec<String>, ServiceError> {
        Ok(self.load_list::<Queued>("queue.yaml")?.iter().map(|q| q.change.id().to_string()).collect())
    }

    pub fn needs_attention(&self) -> Result<Vec<AttentionItem>, ServiceError> {
        self.load_list("attention.yaml")
    }

    /// Collection is read-only for this person on this machine (a push was rejected for lack of access).
    pub fn is_viewer(&self) -> bool {
        self.state_file("viewer").is_file()
    }

    fn set_viewer(&self, on: bool) -> Result<(), ServiceError> {
        let f = self.state_file("viewer");
        if on {
            fs::create_dir_all(self.drafts.dir())?;
            fs::write(f, "")?;
        } else if f.is_file() {
            fs::remove_file(f)?;
        }
        Ok(())
    }

    pub fn offline_status(&self) -> Result<OfflineStatus, ServiceError> {
        Ok(OfflineStatus { queued: self.queued_ids()?, needs_attention: self.needs_attention()?, viewer: self.is_viewer() })
    }

    /// Called when a Conflict for `id` was resolved (Overwrite, Cancel or a later successful Save).
    pub(crate) fn attention_resolved(&self, id: &str) {
        if let Ok(mut items) = self.needs_attention() {
            let before = items.len();
            items.retain(|i| i.request_id != id);
            if items.len() != before {
                let _ = self.store_list("attention.yaml", &items);
            }
        }
    }

    fn enqueue(&self, change: Change, folder_id: Option<&str>) -> Result<(), ServiceError> {
        let mut queue: Vec<Queued> = self.load_list("queue.yaml")?;
        let new = Queued { change, folder_id: folder_id.map(String::from) };
        match queue.iter().position(|q| q.change.id() == new.change.id()) {
            Some(i) => {
                let old = queue.remove(i);
                let folder_id = new.folder_id.clone().or(old.folder_id);
                if let Some(change) = coalesce(old.change, new.change) {
                    queue.insert(i, Queued { change, folder_id });
                }
            }
            None => queue.push(new),
        }
        self.store_list("queue.yaml", &queue)
    }

    fn keep_draft(&self, change: &Change) -> Result<(), ServiceError> {
        match change {
            Change::Create(r) => self.drafts.put(&r.id, None, r.clone()),
            Change::Update { base, ours } => self.drafts.put(&ours.id, Some(base.clone()), ours.clone()),
            Change::Delete { .. } => Ok(()),
        }
    }

    /// Reaction to a typed push failure that is not "offline": keep Drafts, mark Viewer if needed.
    fn rejected(&self, e: ServiceError) -> Result<Result<DraftReason, ServiceError>, ServiceError> {
        Ok(match e {
            ServiceError::ProtectedBranch(_) => Ok(DraftReason::ProtectedBranch { message: e.to_string() }),
            ServiceError::AuthFailed(_) => Ok(DraftReason::AuthFailed { message: e.to_string() }),
            ServiceError::NoWriteAccess(_) => {
                let first = !self.is_viewer();
                self.set_viewer(true)?;
                Ok(DraftReason::NoWriteAccess { message: e.to_string(), first_rejection: first })
            }
            other => Err(other),
        })
    }

    /// For shared writes that are not queued (Folder ops, Environments, defaults, import): keep the
    /// Viewer mark in step with what the host said, exactly like a Request Save does.
    pub(crate) fn track_access<T>(&self, r: Result<T, ServiceError>, pushed: impl Fn(&T) -> bool) -> Result<T, ServiceError> {
        match &r {
            Ok(v) if pushed(v) => {
                let _ = self.set_viewer(false);
            }
            Err(ServiceError::NoWriteAccess(_)) => {
                let _ = self.set_viewer(true);
            }
            _ => {}
        }
        r
    }

    /// Save, but never lose the change: offline -> queued; rejected by the host -> kept as a Draft.
    pub fn save_or_queue(&self, change: Change) -> Result<SaveAttempt, ServiceError> {
        self.save_or_queue_in(change, None)
    }

    /// Like [`save_or_queue`], for a Request created in / moved into Folder `folder_id` (see `save_in`).
    pub fn save_or_queue_in(&self, change: Change, folder_id: Option<&str>) -> Result<SaveAttempt, ServiceError> {
        match self.save_in(change.clone(), folder_id) {
            Ok(outcome) => {
                if matches!(outcome, SaveOutcome::Saved { .. }) {
                    self.set_viewer(false)?; // a push went through: write access is back
                }
                Ok(SaveAttempt::Saved(outcome))
            }
            Err(ServiceError::Offline(_)) => {
                self.keep_draft(&change)?;
                self.enqueue(change, folder_id)?;
                Ok(SaveAttempt::Queued)
            }
            Err(e) => {
                let reason = self.rejected(e)?;
                if let Ok(r) = &reason {
                    self.keep_draft(&change)?;
                    return Ok(SaveAttempt::Draft(r.clone()));
                }
                reason.map(SaveAttempt::Draft)
            }
        }
    }

    /// Replay queued Saves in order (call on reconnect, focus and every minute).
    pub fn drain_queue(&self) -> Result<DrainReport, ServiceError> {
        let mut queue: Vec<Queued> = self.load_list("queue.yaml")?;
        let mut report = DrainReport::default();
        while let Some(Queued { change, folder_id }) = queue.first().cloned() {
            match self.save_in(change.clone(), folder_id.as_deref()) {
                Ok(SaveOutcome::Saved { .. }) => {
                    report.saved.push(change.id().to_string());
                    self.set_viewer(false)?;
                    queue.remove(0);
                }
                Ok(SaveOutcome::Conflict { conflicts, .. }) => {
                    let item = AttentionItem {
                        request_id: change.id().to_string(),
                        name: change_name(&change),
                        change,
                        fields: conflicts.into_iter().map(|c| c.field).collect(),
                    };
                    let mut all = self.needs_attention()?;
                    all.retain(|i| i.request_id != item.request_id);
                    all.push(item.clone());
                    self.store_list("attention.yaml", &all)?;
                    report.needs_attention.push(item);
                    queue.remove(0);
                }
                Err(ServiceError::Offline(_)) => {
                    report.offline = true;
                    break;
                }
                Err(e) => match self.rejected(e) {
                    Ok(Ok(reason)) => {
                        // Drafts are already kept; stop retrying what the host refuses.
                        // Rejected credentials are fixable by signing in again: keep the queue then.
                        if !matches!(reason, DraftReason::AuthFailed { .. }) {
                            queue.clear();
                        }
                        report.stopped = Some(reason);
                        break;
                    }
                    Ok(Err(other)) | Err(other) => {
                        self.store_list("queue.yaml", &queue)?;
                        return Err(other);
                    }
                },
            }
            self.store_list("queue.yaml", &queue)?;
        }
        self.store_list("queue.yaml", &queue)?;
        Ok(report)
    }
}
