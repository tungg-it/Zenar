//! Several tree changes at once (the sidebar's multi-select drag and delete): Request moves /
//! deletes and Folder ops planned one after another on the same remote tip, then one commit and
//! one push. A change the remote no longer allows is left out and reported; the rest is saved.

use zenar_format::RequestItem;

use crate::{tree, Change, FolderOp, Plan, Pushed, SaveOutcome, ServiceError};

/// One change of a batch: a Request Save (`folder_id` as in `save_in`) or a Folder op.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TreeChange {
    Request { change: Change, folder_id: Option<String> },
    Folder { op: FolderOp },
}

/// A change of the batch that was left out: `index` into the batch, `fields` as in `SaveResult::Conflict`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct BatchConflict {
    pub index: u32,
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct BatchResult {
    /// `None` when the remote already had every change (or every change was left out).
    pub commit: Option<String>,
    /// The Requests as saved (the new bases); deleted ones are not listed.
    pub saved: Vec<RequestItem>,
    pub conflicts: Vec<BatchConflict>,
}

impl crate::CollectionService<'_> {
    /// Apply `changes` in order as one commit and one push, with the same fetch and retry as Save.
    /// Later changes see the earlier ones (a Request moved, then its old Folder deleted).
    pub fn save_batch(&self, changes: &[TreeChange]) -> Result<BatchResult, ServiceError> {
        let r = self.commit_push(None, || {
            let (paths, mut messages, value) = self.plan_batch(changes)?;
            Ok(match messages.len() {
                0 => Plan::Nothing(value),
                1 => Plan::Write { message: messages.remove(0), paths, request: value },
                n => Plan::Write { message: format!("Update {n} items\n\n{}", messages.join("\n")), paths, request: value },
            })
        });
        let r = r.map(|p| match p {
            Pushed::Saved { commit, value } => BatchResult { commit, ..value },
            Pushed::Conflict(_) => unreachable!("save_batch never plans a Conflict"),
        });
        self.track_access(r, |o| o.commit.is_some())
    }

    /// Write `changes` in order on the current tip, without committing: the paths written, one
    /// commit-message line per change that wrote something, and what was saved or left out.
    pub(crate) fn plan_batch(&self, changes: &[TreeChange]) -> Result<(Vec<String>, Vec<String>, BatchResult), ServiceError> {
        let (mut paths, mut messages, mut saved, mut conflicts) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        for (i, c) in changes.iter().enumerate() {
            let plan = match c {
                TreeChange::Request { change, folder_id } => match self.resolve_folder(change, folder_id.as_deref())? {
                    Ok(change) => self.plan(&change)?,
                    Err(o) => Plan::Conflict(o),
                },
                TreeChange::Folder { op } => tree::plan(&self.root, op)?,
            };
            match plan {
                Plan::Write { message, paths: p, request } => {
                    paths.extend(p);
                    messages.push(message);
                    saved.extend(request);
                }
                Plan::Nothing(request) => saved.extend(request),
                Plan::Conflict(SaveOutcome::Conflict { conflicts: found, .. }) => {
                    conflicts.push(BatchConflict { index: i as u32, fields: found.into_iter().map(|f| f.field).collect() })
                }
                Plan::Conflict(SaveOutcome::Saved { .. }) => unreachable!("a plan never reports Saved"),
            }
        }
        Ok((paths, messages, BatchResult { commit: None, saved, conflicts }))
    }
}
