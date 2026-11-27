//! Tauri glue for Environments and Secrets. Logic lives in `zenar-store` / `zenar-service`.
//! The active Environment is a local choice (Local store); Secret values live in `secrets.json` in
//! the app data dir (this machine only).

use std::collections::HashMap;
use std::path::Path;

use tauri::{AppHandle, Manager};
use zenar_format::env_file::{export_postman_environment, parse_environment_file};
use zenar_format::{EnvironmentItem, RequestItem};
use zenar_git::{Library, SystemGit};
use zenar_service::{id_generator, CollectionService, SharedSave};
use zenar_store::env_import::{self, EnvImportPlan, TargetChoice};
use zenar_store::secrets::{self, FileSecrets, MissingSecret, SecretStore};
use zenar_store::warnings::{self, TokenWarning};
use zenar_store::LocalStore;

/// This machine's Secret values.
pub fn secret_store(app: &AppHandle) -> Result<FileSecrets, String> {
    Ok(FileSecrets::new(app.path().app_data_dir().map_err(crate::err)?.join("secrets.json")))
}

/// Collection id used in Secret accounts (falls back to the path for folders outside the library).
pub fn collection_id(app: &AppHandle, root: &str) -> Result<String, String> {
    let data = app.path().app_data_dir().map_err(crate::err)?;
    Ok(Library::load(&data.join("collections.json"))
        .ok()
        .and_then(|l| l.list().iter().find(|e| e.path == Path::new(root)).map(|e| e.id.clone()))
        .unwrap_or_else(|| root.to_string()))
}

fn store(app: &AppHandle) -> Result<LocalStore, String> {
    app.path().app_data_dir().map(LocalStore::new).map_err(crate::err)
}

#[tauri::command]
pub fn get_active_environment(app: AppHandle, root: String) -> Result<Option<String>, String> {
    Ok(store(&app)?.active_environment(&root))
}

#[tauri::command]
pub fn set_active_environment(app: AppHandle, root: String, environment_id: Option<String>) -> Result<(), String> {
    store(&app)?.set_active_environment(&root, environment_id.as_deref()).map_err(crate::err)
}

/// Secrets this person still has to fill in, across all Environments.
#[tauri::command]
pub fn list_missing_secrets(app: AppHandle, root: String) -> Result<Vec<MissingSecret>, String> {
    let data = zenar_format::open_collection(Path::new(&root)).map_err(crate::err)?;
    Ok(secrets::missing_secrets(&secret_store(&app)?, &collection_id(&app, &root)?, &data))
}

/// This person's Secret values of an Environment by variable id, shown in its tab.
#[tauri::command]
pub fn get_secret_values(app: AppHandle, root: String, environment: EnvironmentItem) -> Result<HashMap<String, String>, String> {
    secrets::secret_values(&secret_store(&app)?, &collection_id(&app, &root)?, &environment)
}

#[tauri::command]
pub fn set_secret_value(
    app: AppHandle,
    root: String,
    environment_id: String,
    var_id: String,
    value: String,
) -> Result<(), String> {
    secrets::set_secret(&secret_store(&app)?, &collection_id(&app, &root)?, &environment_id, &var_id, &value)
}

/// Save an Environment for everyone, merged by variable with what other Members saved meanwhile.
/// `base` is the Environment as loaded (None for a new one). Secret variables arrive with this
/// person's value in `value`: one that differs from `base` is stored on this machine (emptied: the
/// stored value is deleted), and it is never written to the repo. A caller that never loaded the
/// values sends them empty in both, which leaves the stored values alone.
#[tauri::command]
pub async fn save_environment(
    app: AppHandle,
    root: String,
    base: Option<EnvironmentItem>,
    environment: EnvironmentItem,
    overwrite: bool,
) -> Result<SharedSave, String> {
    let (cid, store) = (collection_id(&app, &root)?, secret_store(&app)?);
    for v in environment.variables.iter().filter(|v| v.secret) {
        let before = base
            .as_ref()
            .and_then(|b| b.variables.iter().find(|x| x.id == v.id && x.secret))
            .map_or("", |x| x.value.as_str());
        if v.value != before {
            secrets::set_secret(&store, &cid, &environment.id, &v.id, &v.value)?;
        }
    }
    // A Secret made shared or removed: its stored value is not needed any more.
    for b in base.iter().flat_map(|b| &b.variables).filter(|b| b.secret) {
        if !environment.variables.iter().any(|v| v.id == b.id && v.secret) {
            store.delete(&secrets::account(&cid, &environment.id, &b.id))?;
        }
    }
    let drafts = crate::store_dir(&app, &root)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::repo_lock::with_repo_lock(Path::new(&root), || {
            let runner = SystemGit::new();
            let svc = CollectionService::new(&runner, Path::new(&root), &drafts);
            svc.save_environment(base.as_ref(), &environment, overwrite).map_err(crate::err)
        })
    })
    .await
    .map_err(crate::err)?
}

/// Share `copy` (a duplicate of `source_id` made by the UI: new id, name, order) as a new Environment.
/// This person's Secret values of the source are copied to it; others fill theirs.
#[tauri::command]
pub async fn duplicate_environment(app: AppHandle, root: String, source_id: String, copy: EnvironmentItem) -> Result<SharedSave, String> {
    let (cid, store) = (collection_id(&app, &root)?, secret_store(&app)?);
    for v in copy.variables.iter().filter(|v| v.secret) {
        if let Some(value) = store.get(&secrets::account(&cid, &source_id, &v.id))?.filter(|s| !s.is_empty()) {
            secrets::set_secret(&store, &cid, &copy.id, &v.id, &value)?;
        }
    }
    let drafts = crate::store_dir(&app, &root)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::repo_lock::with_repo_lock(Path::new(&root), || {
            let runner = SystemGit::new();
            CollectionService::new(&runner, Path::new(&root), &drafts).save_environment(None, &copy, false).map_err(crate::err)
        })
    })
    .await
    .map_err(crate::err)?
}

/// Delete an Environment for every Member. On this machine its Secret values go too, and it stops
/// being the active Environment.
#[tauri::command]
pub async fn delete_environment(app: AppHandle, root: String, environment_id: String) -> Result<SharedSave, String> {
    let cid = collection_id(&app, &root)?;
    let drafts = crate::store_dir(&app, &root)?;
    let env = zenar_format::open_collection(Path::new(&root))
        .map_err(crate::err)?
        .environments
        .into_iter()
        .find(|e| e.id == environment_id);
    let (r, id) = (root.clone(), environment_id.clone());
    let saved = tauri::async_runtime::spawn_blocking(move || {
        crate::repo_lock::with_repo_lock(Path::new(&r), || {
            let runner = SystemGit::new();
            CollectionService::new(&runner, Path::new(&r), &drafts).delete_environment(&id).map_err(crate::err)
        })
    })
    .await
    .map_err(crate::err)??;
    if saved == SharedSave::Saved {
        let secrets_store = secret_store(&app)?;
        for v in env.iter().flat_map(|e| &e.variables).filter(|v| v.secret) {
            secrets_store.delete(&secrets::account(&cid, &environment_id, &v.id))?;
        }
        let store = store(&app)?;
        if store.active_environment(&root).as_deref() == Some(environment_id.as_str()) {
            store.set_active_environment(&root, None).map_err(crate::err)?;
        }
    }
    Ok(saved)
}

/// What importing an environment file (Postman JSON or `.env` text) will do; writes nothing.
/// `file_name` names a new Environment when the file has no name.
#[tauri::command]
pub fn plan_environment_import(
    app: AppHandle,
    root: String,
    text: String,
    file_name: String,
    choice: TargetChoice,
) -> Result<EnvImportPlan, String> {
    let file = parse_environment_file(&text).map_err(crate::err)?;
    let data = zenar_format::open_collection(Path::new(&root)).map_err(crate::err)?;
    let name = file_name.strip_suffix(".postman_environment.json").or_else(|| file_name.strip_suffix(".json")).unwrap_or(&file_name);
    Ok(env_import::plan_environment_import(&secret_store(&app)?, &collection_id(&app, &root)?, &data, &file, &choice, name, &mut id_generator()))
}

/// Fill this person's Secrets of an existing Environment from a plan (this machine only, no Save).
#[tauri::command]
pub fn apply_environment_import(app: AppHandle, root: String, plan: EnvImportPlan) -> Result<(), String> {
    env_import::apply_environment_import(&secret_store(&app)?, &collection_id(&app, &root)?, &plan)
}

/// Write an Environment as a Postman environment file at `path`, with this person's Secret values.
#[tauri::command]
pub fn export_environment(app: AppHandle, root: String, environment_id: String, path: String) -> Result<(), String> {
    let data = zenar_format::open_collection(Path::new(&root)).map_err(crate::err)?;
    let env = data.environments.iter().find(|e| e.id == environment_id).ok_or("this Environment no longer exists")?;
    let values = secrets::secret_values(&secret_store(&app)?, &collection_id(&app, &root)?, env)?;
    std::fs::write(&path, export_postman_environment(env, &values)).map_err(crate::err)
}

/// Shown on Save: headers or body that look like a hard-coded token.
#[tauri::command]
pub fn check_token_warnings(request: RequestItem) -> Vec<TokenWarning> {
    warnings::token_warnings(&request)
}

/// Hard-coded credentials anywhere in the Collection, checked before an export.
#[tauri::command]
pub fn export_token_warnings(root: String) -> Result<Vec<warnings::PlacedTokenWarning>, String> {
    let data = zenar_format::open_collection(Path::new(&root)).map_err(crate::err)?;
    Ok(warnings::collection_token_warnings(&data))
}
