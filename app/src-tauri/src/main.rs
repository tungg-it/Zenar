// Thin Tauri shell: all logic lives in the framework-independent crates.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod collections;
mod environments;
mod conflict;
mod local;
#[cfg(target_os = "macos")]
mod menu;
mod offline;
mod repo_lock;

use std::path::{Path, PathBuf};

use zenar_format::{CollectionData, RequestItem};
use tauri::Manager;
use zenar_git::{Library, SystemGit};
use zenar_http::{HttpRequest, HttpResponse};
use zenar_service::{BatchResult, Change, CollectionService, Defaults, Draft, FolderOp, SaveResult, SharedSave, SyncReport, TreeChange};

/// Error text for the UI (one place for the `Display` to `String` conversion every command needs).
pub(crate) fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
fn open_collection(path: String) -> Result<CollectionData, String> {
    zenar_format::open_collection(Path::new(&path)).map_err(err)
}

#[tauri::command]
async fn send_request(request: HttpRequest) -> Result<HttpResponse, String> {
    zenar_http::send(request).await.map_err(err)
}

/// Compose a (possibly unsaved) Request with its inherited headers/auth and the chosen Environment, then send it.
#[tauri::command]
async fn send_composed(
    app: tauri::AppHandle,
    root: String,
    request: RequestItem,
    environment_id: Option<String>,
) -> Result<HttpResponse, String> {
    local::send_composed(app, root, request, environment_id).await
}

/// Drafts live in the app data dir (never in the repo): `drafts/<collection id>`, the same place
/// that removing a Collection purges. Paths outside the library fall back to a sanitized path key.
pub(crate) fn store_dir(app: &tauri::AppHandle, root: &str) -> Result<PathBuf, String> {
    let data = app.path().app_data_dir().map_err(err)?;
    let key = Library::load(&data.join("collections.json"))
        .ok()
        .and_then(|l| l.list().iter().find(|e| e.path == Path::new(root)).map(|e| e.id.clone()))
        .unwrap_or_else(|| root.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect());
    Ok(data.join("drafts").join(key))
}

/// Local-only service calls (Drafts, queue status): no git, so no lock and safe on the main thread.
fn with_service<T>(
    app: &tauri::AppHandle,
    path: &str,
    f: impl FnOnce(&CollectionService) -> Result<T, zenar_service::ServiceError>,
) -> Result<T, String> {
    let runner = SystemGit::new();
    let svc = CollectionService::new(&runner, Path::new(path), &store_dir(app, path)?);
    f(&svc).map_err(err)
}

/// Service calls that run git (sync, Save, queue, import, conflicts): one at a time per Collection.
/// Call from a blocking thread, never from a sync command (it may wait for another operation).
fn with_git<T>(
    app: &tauri::AppHandle,
    path: &str,
    f: impl FnOnce(&CollectionService) -> Result<T, zenar_service::ServiceError>,
) -> Result<T, String> {
    repo_lock::with_repo_lock(Path::new(path), || with_service(app, path, f))
}

/// Auto-pull: called on open, window focus and every minute.
#[tauri::command]
async fn sync_collection(app: tauri::AppHandle, path: String) -> Result<SyncReport, String> {
    tauri::async_runtime::spawn_blocking(move || with_git(&app, &path, |s| s.sync()))
        .await
        .map_err(err)?
}

/// Save = fetch, merge by Field, commit, push (retry when rejected).
#[tauri::command]
async fn save_change(app: tauri::AppHandle, path: String, change: Change, folder_id: Option<String>) -> Result<SaveResult, String> {
    tauri::async_runtime::spawn_blocking(move || with_git(&app, &path, |s| s.save_in(change, folder_id.as_deref()).map(Into::into)))
        .await
        .map_err(err)?
}

/// Folder create, rename, move, reorder, delete (same fetch, commit, push as Save).
#[tauri::command]
async fn folder_op(app: tauri::AppHandle, path: String, op: FolderOp) -> Result<SaveResult, String> {
    tauri::async_runtime::spawn_blocking(move || with_git(&app, &path, |s| s.folder_op(op).map(Into::into)))
        .await
        .map_err(err)?
}

/// Several tree changes (multi-select drag / delete) as one commit and one push.
#[tauri::command]
async fn save_batch(app: tauri::AppHandle, path: String, changes: Vec<TreeChange>) -> Result<BatchResult, String> {
    tauri::async_runtime::spawn_blocking(move || with_git(&app, &path, |s| s.save_batch(&changes)))
        .await
        .map_err(err)?
}

/// Save the inherited headers/auth of the Collection (`folder_id` None) or a Folder: fetch, merge by
/// Field, commit, push, like a Request Save. `overwrite` resolves a reported Conflict in my favour.
#[tauri::command]
async fn save_defaults(
    app: tauri::AppHandle,
    path: String,
    folder_id: Option<String>,
    base: Defaults,
    ours: Defaults,
    overwrite: bool,
) -> Result<SharedSave, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_git(&app, &path, |s| s.save_defaults(folder_id.as_deref(), &base, &ours, overwrite))
    })
    .await
    .map_err(err)?
}

/// Import a Postman v2.1 collection (JSON text) as one commit, then push.
#[tauri::command]
async fn import_postman(app: tauri::AppHandle, path: String, json: String) -> Result<zenar_service::ImportReport, String> {
    tauri::async_runtime::spawn_blocking(move || with_git(&app, &path, |s| s.import_postman(&json)))
        .await
        .map_err(err)?
}

/// Write the Collection as a Postman v2.1 collection at `path`; returns what Postman cannot hold.
#[tauri::command]
fn export_collection(path: String, file: String) -> Result<Vec<String>, String> {
    let data = zenar_format::open_collection(std::path::Path::new(&path)).map_err(err)?;
    let out = zenar_format::postman_export::export_postman(&data);
    std::fs::write(&file, out.json).map_err(err)?;
    Ok(out.warnings)
}

#[tauri::command]
fn list_drafts(app: tauri::AppHandle, path: String) -> Result<Vec<Draft>, String> {
    with_service(&app, &path, |s| s.drafts().load())
}

#[tauri::command]
fn put_draft(app: tauri::AppHandle, path: String, base: Option<RequestItem>, draft: RequestItem) -> Result<(), String> {
    with_service(&app, &path, |s| s.drafts().put(&draft.id.clone(), base, draft))
}

#[tauri::command]
fn discard_draft(app: tauri::AppHandle, path: String, request_id: String) -> Result<(), String> {
    with_service(&app, &path, |s| s.drafts().remove(&request_id))
}

fn main() {
    let builder = tauri::Builder::default();
    // ⌘T / ⌘S / ⌘W / ⌥⌘W act on Request tabs, not the window; ⌘= / ⌘- / ⌘0 zoom (see menu.rs).
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(menu::on_event);
    builder
        // File pickers for form-data files and binary bodies.
        .plugin(tauri_plugin_dialog::init())
        // Author links in Settings → About open in the default browser.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_collection,
            send_request,
            send_composed,
            sync_collection,
            save_change,
            folder_op,
            save_batch,
            import_postman,
            export_collection,
            conflict::conflict_info,
            conflict::overwrite_change,
            conflict::cancel_change,
            offline::save_or_queue,
            offline::drain_queue,
            offline::offline_status,
            list_drafts,
            put_draft,
            discard_draft,
            save_defaults,
            local::preview_request,
            local::get_run_options,
            local::set_run_options,
            local::get_captured,
            local::clear_captured,
            local::apply_script_vars,
            local::get_history,
            local::clear_history,
            collections::list_collections,
            collections::add_collection,
            collections::open_collection_by_id,
            collections::remove_collection,
            collections::author_missing,
            collections::set_author,
            collections::open_in_browser,
            environments::get_active_environment,
            environments::set_active_environment,
            environments::list_missing_secrets,
            environments::get_secret_values,
            environments::set_secret_value,
            environments::save_environment,
            environments::delete_environment,
            environments::duplicate_environment,
            environments::check_token_warnings,
            environments::export_token_warnings,
            environments::plan_environment_import,
            environments::apply_environment_import,
            environments::export_environment
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zenar");
}
