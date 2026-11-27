//! Tauri glue for the Local store (Captured Variables, cookies, history, runner options).
//! Everything lives in the app data dir, never in a Collection repo.

use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};
use zenar_format::RequestItem;
use zenar_http::{HttpResponse, RequestPreview, RunOptions};
use zenar_store::{HistoryEntry, LocalStore};

fn store(app: &AppHandle) -> Result<LocalStore, String> {
    app.path().app_data_dir().map(LocalStore::new).map_err(crate::err)
}

/// Environment variables with this machine's Secrets (unfilled Secrets left out).
fn env_vars(app: &AppHandle, root: &str, collection: &zenar_format::CollectionData, environment_id: Option<String>) -> Result<HashMap<String, String>, String> {
    let cid = crate::environments::collection_id(app, root)?;
    let store = crate::environments::secret_store(app)?;
    Ok(environment_id
        .and_then(|id| collection.environments.iter().find(|e| e.id == id))
        .map(|e| zenar_store::secrets::environment_vars(&store, &cid, e))
        .unwrap_or_default())
}

/// Compose with the Environment plus Captured Variables, send with this Collection's cookies and
/// the machine's TLS/proxy options, then record captures, cookies and history locally.
pub async fn send_composed(
    app: AppHandle,
    root: String,
    request: RequestItem,
    environment_id: Option<String>,
) -> Result<HttpResponse, String> {
    let store = store(&app)?;
    let collection = zenar_format::open_collection(Path::new(&root)).map_err(crate::err)?;
    let env_vars = env_vars(&app, &root, &collection, environment_id)?;
    let captured = store.captured(&root);
    let mut jar = store.cookies(&root);
    let out = zenar_http::run(&collection, &request, &env_vars, &captured, &store.options(), &mut jar)
        .await
        .map_err(crate::err)?;
    store.save_cookies(&root, &jar).map_err(crate::err)?;
    store.merge_captured(&root, &out.captured).map_err(crate::err)?;
    let at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    store
        .append_history(&root, HistoryEntry { at_ms, request_id: request.id, request: out.sent, response: out.response.clone() })
        .map_err(crate::err)?;
    Ok(out.response)
}

/// The request Send would make (for the code snippet) and the variables it uses; nothing is sent.
#[tauri::command]
pub fn preview_request(
    app: AppHandle,
    root: String,
    request: RequestItem,
    environment_id: Option<String>,
) -> Result<RequestPreview, String> {
    let collection = zenar_format::open_collection(Path::new(&root)).map_err(crate::err)?;
    let env_vars = env_vars(&app, &root, &collection, environment_id)?;
    Ok(zenar_http::preview(&collection, &request, &env_vars, &store(&app)?.captured(&root)))
}

#[tauri::command]
pub fn get_run_options(app: AppHandle) -> Result<RunOptions, String> {
    Ok(store(&app)?.options())
}

#[tauri::command]
pub fn set_run_options(app: AppHandle, options: RunOptions) -> Result<(), String> {
    store(&app)?.set_options(&options).map_err(crate::err)
}

#[tauri::command]
pub fn get_captured(app: AppHandle, root: String) -> Result<HashMap<String, String>, String> {
    Ok(store(&app)?.captured(&root))
}

/// Variables a script set or unset. Scripts never write the shared Environment: every `set` lands
/// in the Captured Variables of this machine, like a capture rule.
#[tauri::command]
pub fn apply_script_vars(app: AppHandle, root: String, set: HashMap<String, String>, unset: Vec<String>) -> Result<(), String> {
    let store = store(&app)?;
    store.remove_captured(&root, &unset).map_err(crate::err)?;
    store.merge_captured(&root, &set.into_iter().collect::<Vec<_>>()).map_err(crate::err)
}

#[tauri::command]
pub fn clear_captured(app: AppHandle, root: String) -> Result<(), String> {
    store(&app)?.clear_captured(&root).map_err(crate::err)
}

#[tauri::command]
pub fn get_history(app: AppHandle, root: String) -> Result<Vec<HistoryEntry>, String> {
    Ok(store(&app)?.history(&root))
}

#[tauri::command]
pub fn clear_history(app: AppHandle, root: String) -> Result<(), String> {
    store(&app)?.clear_history(&root).map_err(crate::err)
}
