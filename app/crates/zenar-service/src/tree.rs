//! Folder operations (ADR 0003): Folders are directories identified by the `id` in `folder.yaml`,
//! so rename and move are followed by id. Planning only touches the working tree; the caller
//! commits and pushes.

use std::fs;
use std::path::Path;

use zenar_format::{open_collection, save_folder, slugify, CollectionData, FolderItem};
use zenar_merge::{Conflict, ConflictKind};

use crate::{Plan, SaveOutcome, ServiceError};

/// One Folder operation. Folders are addressed by id, never by path.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FolderOp {
    /// New (possibly nested) Folder; `id` is chosen by the caller.
    Create { id: String, name: String, parent_id: Option<String>, order: f64 },
    Rename { id: String, name: String },
    /// `parent_id: None` moves it to the Collection root.
    Move { id: String, parent_id: Option<String> },
    /// Sparse-order change: rewrites one line of `folder.yaml`.
    Reorder { id: String, order: f64 },
    /// `known_request_ids` are the Requests the user saw inside; any other Request found inside
    /// the Folder on the remote makes this a Conflict instead of silently deleting it.
    Delete { id: String, known_request_ids: Vec<String> },
}

fn conflict(field: String, kind: ConflictKind) -> Plan {
    Plan::Conflict(SaveOutcome::Conflict { conflicts: vec![Conflict { field, kind }], theirs: None })
}

fn join(parent: &str, name: &str) -> String {
    if parent.is_empty() { name.to_string() } else { format!("{parent}/{name}") }
}

fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map(|(p, _)| p).unwrap_or("")
}

fn dir_name(path: &str) -> &str {
    path.rsplit_once('/').map(|(_, n)| n).unwrap_or(path)
}

/// `slug`, `slug-2`, ... not colliding (case-insensitively) with a sibling; `own` is ignored.
fn unique_dir(root: &Path, parent: &str, slug: &str, own: Option<&str>) -> String {
    let dir = if parent.is_empty() { root.to_path_buf() } else { root.join(parent) };
    let taken: Vec<String> = fs::read_dir(&dir)
        .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_lowercase()).collect())
        .unwrap_or_default();
    let own = own.map(str::to_lowercase);
    let mut n = 1;
    loop {
        let c = if n == 1 { slug.to_string() } else { format!("{slug}-{n}") };
        if own.as_deref() == Some(&c) || !taken.contains(&c) {
            return c;
        }
        n += 1;
    }
}

fn find<'a>(d: &'a CollectionData, id: &str) -> Option<&'a FolderItem> {
    d.folders.iter().find(|f| f.id == id)
}

fn msg(verb: &str, name: &str, path: &str) -> String {
    match parent_of(path) {
        "" => format!("{verb} folder \"{name}\""),
        p => format!("{verb} folder \"{name}\" ({p}/)"),
    }
}

pub(crate) fn plan(root: &Path, op: &FolderOp) -> Result<Plan, ServiceError> {
    let data = open_collection(root)?;
    let write = |message: String, paths: Vec<String>| Ok(Plan::Write { message, paths, request: None });
    match op {
        FolderOp::Create { id, name, parent_id, order } => {
            if find(&data, id).is_some() {
                return Ok(Plan::Nothing(None));
            }
            let parent = match parent_id {
                None => String::new(),
                Some(pid) => match find(&data, pid) {
                    Some(p) => p.path.clone(),
                    None => return Ok(conflict(format!("folders/{pid}"), ConflictKind::EditVsDelete)),
                },
            };
            let path = join(&parent, &unique_dir(root, &parent, &slugify(name), None));
            let f = FolderItem { id: id.clone(), path: path.clone(), name: name.clone(), order: *order, headers: vec![], auth: None, extra: None };
            save_folder(root, &f)?;
            write(msg("Create", name, &path), vec![path])
        }
        FolderOp::Rename { id, name } => {
            let Some(f) = find(&data, id) else { return Ok(conflict(format!("folders/{id}"), ConflictKind::EditVsDelete)) };
            if f.name == *name {
                return Ok(Plan::Nothing(None));
            }
            let parent = parent_of(&f.path).to_string();
            let new_path = join(&parent, &unique_dir(root, &parent, &slugify(name), Some(dir_name(&f.path))));
            if new_path != f.path {
                fs::rename(root.join(&f.path), root.join(&new_path))?;
            }
            save_folder(root, &FolderItem { path: new_path.clone(), name: name.clone(), ..f.clone() })?;
            write(msg("Rename", name, &new_path), vec![f.path.clone(), new_path])
        }
        FolderOp::Move { id, parent_id } => {
            let Some(f) = find(&data, id) else { return Ok(conflict(format!("folders/{id}"), ConflictKind::EditVsDelete)) };
            let parent = match parent_id {
                None => String::new(),
                Some(pid) => match find(&data, pid) {
                    Some(p) => p.path.clone(),
                    None => return Ok(conflict(format!("folders/{pid}"), ConflictKind::EditVsDelete)),
                },
            };
            if parent == f.path || parent.starts_with(&format!("{}/", f.path)) {
                return Err(ServiceError::Tree("cannot move a Folder into itself".into()));
            }
            if parent == parent_of(&f.path) {
                return Ok(Plan::Nothing(None));
            }
            let new_path = join(&parent, &unique_dir(root, &parent, dir_name(&f.path), None));
            fs::rename(root.join(&f.path), root.join(&new_path))?;
            write(msg("Move", &f.name, &new_path), vec![f.path.clone(), new_path])
        }
        FolderOp::Reorder { id, order } => {
            let Some(f) = find(&data, id) else { return Ok(conflict(format!("folders/{id}"), ConflictKind::EditVsDelete)) };
            if f.order == *order {
                return Ok(Plan::Nothing(None));
            }
            save_folder(root, &FolderItem { order: *order, ..f.clone() })?;
            write(msg("Reorder", &f.name, &f.path), vec![f.path.clone()])
        }
        FolderOp::Delete { id, known_request_ids } => {
            let Some(f) = find(&data, id) else { return Ok(Plan::Nothing(None)) };
            let inside = |p: &str| p == f.path || p.starts_with(&format!("{}/", f.path));
            for r in data.requests.iter().filter(|r| inside(&r.folder)) {
                if !known_request_ids.contains(&r.id) {
                    return Ok(conflict(format!("requests/{}", r.id), ConflictKind::EditVsDelete));
                }
            }
            fs::remove_dir_all(root.join(&f.path))?;
            write(msg("Delete", &f.name, &f.path), vec![f.path.clone()])
        }
    }
}
