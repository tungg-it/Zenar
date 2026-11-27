//! Tauri commands for the Collection list (sidebar, add, open in browser, remove).
//! Logic lives in `zenar-git`; this file only wires paths and the OS.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use zenar_format::CollectionData;
use zenar_git::{
    author_missing as git_author_missing, open_collection_from_url, parse_remote_url, set_author as git_set_author, Author, OpenRepoError, Library, LibraryEntry, LocalDataPurger, RemoveOutcome,
    SystemGit,
};

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(crate::err)
}

fn library(app: &AppHandle) -> Result<Library, String> {
    Library::load(&data_dir(app)?.join("collections.json")).map_err(crate::err)
}

/// Per-Collection data outside the clone. Directories are keyed by Collection id:
/// `drafts/<id>`, `cookies/<id>`. Its Secrets (`secrets.json`, account prefix `<id>/`) go too.
struct Purger(PathBuf);

impl LocalDataPurger for Purger {
    fn purge(&self, c: &LibraryEntry) -> Result<(), String> {
        for sub in ["drafts", "cookies"] {
            let p = self.0.join(sub).join(&c.id);
            if p.exists() {
                std::fs::remove_dir_all(&p).map_err(crate::err)?;
            }
        }
        // Secrets of this Collection (found via its Environments; a clone that no
        // longer opens has nothing to enumerate).
        if let Ok(data) = zenar_format::open_collection(&c.path) {
            zenar_store::secrets::delete_collection_secrets(&zenar_store::secrets::FileSecrets::new(self.0.join("secrets.json")), &c.id, &data)?;
        }
        Ok(())
    }
}

pub const AUTHOR_REQUIRED: &str = "AUTHOR_REQUIRED";

#[derive(Clone, serde::Deserialize)]
pub struct AuthorInput {
    pub name: String,
    pub email: String,
}

#[tauri::command]
pub fn list_collections(app: AppHandle) -> Result<Vec<LibraryEntry>, String> {
    Ok(library(&app)?.list().to_vec())
}

/// Clone (or initialize) the repo at `url` and register it.
#[tauri::command]
///
/// Fails with exactly `AUTHOR_REQUIRED` when git has no commit author yet: the UI then asks for a
/// name and email and calls this again with `author` (stored in the clone only, not globally).
pub fn add_collection(app: AppHandle, url: String, author: Option<AuthorInput>) -> Result<LibraryEntry, String> {
    let remote = parse_remote_url(&url).map_err(crate::err)?;
    let dir = data_dir(&app)?;
    let mut lib = library(&app)?;
    if let Some(e) = lib.list().iter().find(|e| e.url == remote.as_str()) {
        return Err(format!("This Collection is already on this machine: {}", e.name));
    }
    let entry = lib
        .add(&remote.repo_name(), remote.as_str(), dir.join("clones"))
        .map_err(crate::err)?;
    let mut given = || author.clone().map(|a| Author { name: a.name, email: a.email });
    if let Err(e) = open_collection_from_url(&SystemGit::new(), remote.as_str(), &entry.path, &mut given) {
        let _ = lib.take(&entry.id);
        return Err(match e {
            OpenRepoError::AuthorRequired => AUTHOR_REQUIRED.to_string(),
            e => e.to_string(),
        });
    }
    Ok(entry)
}

#[tauri::command]
pub fn open_collection_by_id(app: AppHandle, id: String) -> Result<CollectionData, String> {
    let lib = library(&app)?;
    let e = lib.get(&id).ok_or("Unknown Collection")?;
    zenar_format::open_collection(&e.path).map_err(crate::err)
}

/// `unpushed` is set (and nothing removed) when Saves exist only on this machine
/// and `confirm` is false.
#[derive(serde::Serialize)]
pub struct RemoveResult {
    pub removed: bool,
    pub unpushed: usize,
}

/// Waits for any sync / Save running on this Collection before deleting its clone.
#[tauri::command]
pub async fn remove_collection(app: AppHandle, id: String, confirm: bool) -> Result<RemoveResult, String> {
    let root = clone_path(&app, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::repo_lock::with_repo_lock(&root, || {
            let mut lib = library(&app)?;
            let purger = Purger(data_dir(&app)?);
            match zenar_git::remove_collection(&SystemGit::new(), &mut lib, &id, &purger, confirm).map_err(crate::err)? {
                RemoveOutcome::Removed => Ok(RemoveResult { removed: true, unpushed: 0 }),
                RemoveOutcome::UnpushedSaves(n) => Ok(RemoveResult { removed: false, unpushed: n }),
            }
        })
    })
    .await
    .map_err(crate::err)?
}

/// Opens the pasted URL itself in the browser (ADR 0007: no host-specific Member page).
#[tauri::command]
pub fn open_in_browser(app: AppHandle, id: String) -> Result<(), String> {
    let lib = library(&app)?;
    let e = lib.get(&id).ok_or("Unknown Collection")?;
    // Only URLs that passed parse_remote_url (https) are ever stored.
    let url = parse_remote_url(&e.url).map_err(crate::err)?;
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(url.as_str()).spawn().map_err(crate::err)?;
    Ok(())
}

fn clone_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(library(app)?.get(id).ok_or("Unknown Collection")?.path.clone())
}

/// A Collection cloned earlier may have no commit author yet (the first Save would fail).
#[tauri::command]
pub fn author_missing(app: AppHandle, id: String) -> Result<bool, String> {
    git_author_missing(&SystemGit::new(), &clone_path(&app, &id)?).map_err(crate::err)
}

#[tauri::command]
pub fn set_author(app: AppHandle, id: String, author: AuthorInput) -> Result<(), String> {
    git_set_author(&SystemGit::new(), &clone_path(&app, &id)?, &Author { name: author.name, email: author.email })
        .map_err(crate::err)
}
