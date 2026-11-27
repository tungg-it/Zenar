//! Offline queue / Needs Attention / Viewer commands; see zenar-service::offline.
use zenar_service::{AttemptResult, Change, DrainReport, OfflineStatus};

use crate::with_service;

/// Save, but never lose the change: offline -> queued, host rejection -> Draft (+ Viewer mark).
#[tauri::command]
pub async fn save_or_queue(app: tauri::AppHandle, path: String, change: Change, folder_id: Option<String>) -> Result<AttemptResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::with_git(&app, &path, |s| s.save_or_queue_in(change, folder_id.as_deref()).map(Into::into)))
        .await
        .map_err(crate::err)?
}

/// Push queued Saves (on reconnect, focus, every minute). Conflicts land in Needs Attention.
#[tauri::command]
pub async fn drain_queue(app: tauri::AppHandle, path: String) -> Result<DrainReport, String> {
    tauri::async_runtime::spawn_blocking(move || crate::with_git(&app, &path, |s| s.drain_queue()))
        .await
        .map_err(crate::err)?
}

#[tauri::command]
pub fn offline_status(app: tauri::AppHandle, path: String) -> Result<OfflineStatus, String> {
    with_service(&app, &path, |s| s.offline_status())
}
