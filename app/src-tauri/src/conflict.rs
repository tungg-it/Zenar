//! Conflict resolution commands (Overwrite / Cancel); see zenar-service::conflict.
use zenar_service::{Change, ConflictInfo, Draft, SaveResult};


/// Details for the side-by-side Conflict view (remote version, author, time, conflicting Fields).
#[tauri::command]
pub async fn conflict_info(app: tauri::AppHandle, path: String, change: Change) -> Result<ConflictInfo, String> {
    tauri::async_runtime::spawn_blocking(move || crate::with_git(&app, &path, |s| s.conflict_info(&change)))
        .await
        .map_err(crate::err)?
}

/// Overwrite: new commit on top of remote, mine wins on conflicting Fields only. Clears the Draft on success.
#[tauri::command]
pub async fn overwrite_change(app: tauri::AppHandle, path: String, change: Change) -> Result<SaveResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::with_git(&app, &path, |s| s.overwrite(change).map(Into::into)))
        .await
        .map_err(crate::err)?
}

/// Cancel: take the remote, keep my changes as a Draft.
#[tauri::command]
pub async fn cancel_change(app: tauri::AppHandle, path: String, change: Change) -> Result<Option<Draft>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::with_git(&app, &path, |s| s.cancel(&change)))
        .await
        .map_err(crate::err)?
}
