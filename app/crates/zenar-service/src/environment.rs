//! Shared files that are not Requests: Environments (one file each), Collection defaults
//! (`collection.yaml`) and Folder defaults (`folder.yaml`). Like a Request Save they are fetched,
//! merged by Field against the remote tip (ADR 0002), committed and pushed through `commit_push`.
//! Secret values are never written (`zenar_format::save_environment` drops them).

use zenar_format::{open_collection, save_collection_defaults, save_environment, save_folder, Auth, CollectionData, EnvironmentItem, KeyValue};
use zenar_merge::{merge, overwrite, Conflict, ConflictKind, Mergeable};

use crate::{CollectionService, Plan, Pushed, SaveOutcome, ServiceError};

/// Result of saving an Environment or defaults; the UI reloads the Collection afterwards.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SharedSave {
    Saved,
    /// Another Member changed the same Field(s) or deleted the file. `fields` are Field paths
    /// (`variables/<id>`, `headers/<id>`, `auth`, `environments/<id>`, ...).
    Conflict { fields: Vec<String> },
}

/// Headers and auth inherited by every Request (Collection) or every Request in a Folder.
#[derive(Debug, Clone, PartialEq, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct Defaults {
    pub headers: Vec<KeyValue>,
    #[serde(default)]
    #[ts(optional)]
    pub auth: Option<Auth>,
}

fn conflict(field: String, kind: ConflictKind) -> Plan<()> {
    Plan::Conflict(SaveOutcome::Conflict { conflicts: vec![Conflict { field, kind }], theirs: None })
}

fn conflicts(cx: Vec<Conflict>) -> Plan<()> {
    Plan::Conflict(SaveOutcome::Conflict { conflicts: cx, theirs: None })
}

fn without_secret_values(e: &EnvironmentItem) -> EnvironmentItem {
    let mut e = e.clone();
    for v in e.variables.iter_mut().filter(|v| v.secret) {
        v.value.clear();
    }
    e
}

/// Three-way merge; on Conflict either report it or (when `overwrite_conflicts`) take `ours` there.
fn resolve<T: Mergeable>(base: &T, ours: &T, theirs: &T, overwrite_conflicts: bool) -> Result<T, Vec<Conflict>> {
    match merge(base, ours, theirs) {
        Err(_) if overwrite_conflicts => Ok(overwrite(base, ours, theirs)),
        r => r,
    }
}

fn shared(p: Pushed<()>) -> SharedSave {
    match p {
        Pushed::Saved { .. } => SharedSave::Saved,
        Pushed::Conflict(SaveOutcome::Conflict { conflicts, .. }) => SharedSave::Conflict { fields: conflicts.into_iter().map(|c| c.field).collect() },
        Pushed::Conflict(SaveOutcome::Saved { .. }) => SharedSave::Saved,
    }
}

impl CollectionService<'_> {
    /// Save an Environment. `base` is the Environment as this person last loaded it (`None` for a
    /// new one); concurrent edits by another Member to other variables are merged, edits to the
    /// same variable are a Conflict unless `overwrite_conflicts`.
    pub fn save_environment(&self, base: Option<&EnvironmentItem>, ours: &EnvironmentItem, overwrite_conflicts: bool) -> Result<SharedSave, ServiceError> {
        let ours = without_secret_values(ours);
        let base = base.map(without_secret_values);
        let r = self.commit_push(None, || {
            let data = open_collection(&self.root)?;
            let theirs = data.environments.iter().find(|e| e.id == ours.id);
            let (merged, verb) = match (&base, theirs) {
                (_, None) if base.is_some() && !overwrite_conflicts => {
                    return Ok(conflict(format!("environments/{}", ours.id), ConflictKind::EditVsDelete));
                }
                (_, None) => (EnvironmentItem { path: String::new(), ..ours.clone() }, "Create"),
                (None, Some(t)) => (EnvironmentItem { path: t.path.clone(), ..ours.clone() }, "Update"),
                (Some(b), Some(t)) => match resolve(b, &ours, &without_secret_values(t), overwrite_conflicts) {
                    Ok(m) => (EnvironmentItem { path: t.path.clone(), ..m }, "Update"),
                    Err(cx) => return Ok(conflicts(cx)),
                },
            };
            let path = save_environment(&self.root, &merged)?;
            Ok(Plan::Write { message: format!("{verb} \"{}\" (environments/)", merged.name), paths: vec![path], request: () })
        });
        self.track_access(r.map(shared), |s| *s == SharedSave::Saved)
    }

    /// Delete an Environment for every Member: one commit "Delete "<name>" (environments/)", then push.
    /// Already gone on the remote: nothing to commit. Secret values are local and not touched here.
    pub fn delete_environment(&self, id: &str) -> Result<SharedSave, ServiceError> {
        let r = self.commit_push(None, || {
            let data = open_collection(&self.root)?;
            let Some(e) = data.environments.iter().find(|e| e.id == id) else {
                return Ok(Plan::Nothing(()));
            };
            std::fs::remove_file(self.root.join(&e.path)).map_err(zenar_format::OpenError::from)?;
            Ok(Plan::Write { message: format!("Delete \"{}\" (environments/)", e.name), paths: vec![e.path.clone()], request: () })
        });
        self.track_access(r.map(shared), |s| *s == SharedSave::Saved)
    }

    /// Save the inherited headers and auth of the Collection (`folder_id: None`) or of a Folder.
    /// `base` is what this person last loaded; merged by Field like a Request.
    pub fn save_defaults(&self, folder_id: Option<&str>, base: &Defaults, ours: &Defaults, overwrite_conflicts: bool) -> Result<SharedSave, ServiceError> {
        let r = self.commit_push(None, || {
            let data = open_collection(&self.root)?;
            match folder_id {
                None => {
                    let with = |d: &Defaults| CollectionData { headers: d.headers.clone(), auth: d.auth.clone(), ..data.clone() };
                    match resolve(&with(base), &with(ours), &data, overwrite_conflicts) {
                        Ok(m) => {
                            save_collection_defaults(&self.root, &m.headers, m.auth.as_ref())?;
                            Ok(Plan::Write { message: "Update \"Collection defaults\"".into(), paths: vec!["collection.yaml".into()], request: () })
                        }
                        Err(cx) => Ok(conflicts(cx)),
                    }
                }
                Some(id) => {
                    let Some(theirs) = data.folders.iter().find(|f| f.id == id) else {
                        return Ok(conflict(format!("folders/{id}"), ConflictKind::EditVsDelete));
                    };
                    let with = |d: &Defaults| zenar_format::FolderItem { headers: d.headers.clone(), auth: d.auth.clone(), ..theirs.clone() };
                    match resolve(&with(base), &with(ours), theirs, overwrite_conflicts) {
                        Ok(m) => {
                            save_folder(&self.root, &m)?;
                            Ok(Plan::Write {
                                message: format!("Update \"Folder defaults\" ({}/)", m.path),
                                paths: vec![format!("{}/folder.yaml", m.path)],
                                request: (),
                            })
                        }
                        Err(cx) => Ok(conflicts(cx)),
                    }
                }
            }
        });
        self.track_access(r.map(shared), |s| *s == SharedSave::Saved)
    }
}
