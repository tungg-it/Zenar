//! Local store: per-machine state that must never enter a Collection repo (ADR 0004): Captured
//! Variables, cookie jars, response history and runner options. Lives in a directory the app
//! chooses (the app data dir). Framework-independent (no Tauri).
//!
//! Layout: `<dir>/options.json`, `<dir>/collections/<key-hash>/{captured,cookies,history}.json`.
//! Collections are identified by a caller-supplied key (e.g. the clone path). Reads of missing or
//! corrupt files yield empty values; writes are atomic (temp file + rename).

pub mod env_import;
pub mod secrets;
pub mod warnings;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use zenar_http::{CookieJar, HttpRequest, HttpResponse, RunOptions};

/// Entries kept per Collection; the oldest are dropped first.
pub const HISTORY_LIMIT: usize = 100;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("local store io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("local store serialize error: {0}")]
    Serialize(#[from] serde_json::Error),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct HistoryEntry {
    /// Unix milliseconds when the request was sent.
    pub at_ms: u64,
    pub request_id: String,
    /// As sent (variables resolved, so it may contain Secret values: stays on this machine).
    pub request: HttpRequest,
    pub response: HttpResponse,
}

pub struct LocalStore {
    dir: PathBuf,
}

/// FNV-1a: stable across Rust versions (unlike `DefaultHasher`).
fn key_hash(key: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in key.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

fn read<T: DeserializeOwned + Default>(path: &Path) -> T {
    fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write<T: Serialize>(path: &Path, value: &T) -> Result<(), StoreError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

impl LocalStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn file(&self, collection: &str, name: &str) -> PathBuf {
        self.dir.join("collections").join(key_hash(collection)).join(format!("{name}.json"))
    }

    pub fn captured(&self, collection: &str) -> HashMap<String, String> {
        read(&self.file(collection, "captured"))
    }

    /// Add or overwrite Captured Variables.
    pub fn merge_captured(&self, collection: &str, pairs: &[(String, String)]) -> Result<(), StoreError> {
        let mut all = self.captured(collection);
        all.extend(pairs.iter().cloned());
        write(&self.file(collection, "captured"), &all)
    }

    /// Remove some Captured Variables (a script's `unset`); unknown names are ignored.
    pub fn remove_captured(&self, collection: &str, names: &[String]) -> Result<(), StoreError> {
        let mut all = self.captured(collection);
        for n in names {
            all.remove(n);
        }
        write(&self.file(collection, "captured"), &all)
    }

    pub fn clear_captured(&self, collection: &str) -> Result<(), StoreError> {
        write(&self.file(collection, "captured"), &HashMap::<String, String>::new())
    }

    pub fn cookies(&self, collection: &str) -> CookieJar {
        read(&self.file(collection, "cookies"))
    }

    pub fn save_cookies(&self, collection: &str, jar: &CookieJar) -> Result<(), StoreError> {
        write(&self.file(collection, "cookies"), jar)
    }

    /// Newest first.
    pub fn history(&self, collection: &str) -> Vec<HistoryEntry> {
        read(&self.file(collection, "history"))
    }

    pub fn append_history(&self, collection: &str, entry: HistoryEntry) -> Result<(), StoreError> {
        let mut all = self.history(collection);
        all.insert(0, entry);
        all.truncate(HISTORY_LIMIT);
        write(&self.file(collection, "history"), &all)
    }

    pub fn clear_history(&self, collection: &str) -> Result<(), StoreError> {
        write(&self.file(collection, "history"), &Vec::<HistoryEntry>::new())
    }

    /// The Environment this person picked for the Collection (a local choice, never in the repo).
    pub fn active_environment(&self, collection: &str) -> Option<String> {
        read::<Option<String>>(&self.file(collection, "active_environment"))
    }

    pub fn set_active_environment(&self, collection: &str, environment_id: Option<&str>) -> Result<(), StoreError> {
        write(&self.file(collection, "active_environment"), &environment_id)
    }

    pub fn options(&self) -> RunOptions {
        read(&self.dir.join("options.json"))
    }

    pub fn set_options(&self, options: &RunOptions) -> Result<(), StoreError> {
        write(&self.dir.join("options.json"), options)
    }
}
