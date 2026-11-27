//! Secrets: Environment variables marked `secret` hold their value only on this machine, never in
//! a repo file. The store sits behind [`SecretStore`]: [`FileSecrets`] (a file in the app data dir,
//! readable only by this user) in the app, [`MemorySecrets`] for tests.
//!
//! Account: `<collection id>/<environment id>/<variable id>`. Keyed by id, so renaming a variable
//! or Environment keeps its value. An unfilled Secret is simply absent from the runner's variables,
//! so a Request using it fails with "variable has no value".

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use ts_rs::TS;
use zenar_format::{CollectionData, EnvironmentItem};

pub trait SecretStore {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, value: &str) -> Result<(), String>;
    /// Deleting a missing entry is not an error.
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// In-memory fake for tests.
#[derive(Default)]
pub struct MemorySecrets(Mutex<HashMap<String, String>>);

impl SecretStore for MemorySecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(account.to_string(), value.to_string());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

/// Secret values in one JSON file (`account -> value`), e.g. `<app data>/secrets.json`. Plain text,
/// like the rest of the Local store; on Unix the file is made readable by this user only.
pub struct FileSecrets {
    path: PathBuf,
}

impl FileSecrets {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    fn all(&self) -> HashMap<String, String> {
        crate::read(&self.path)
    }

    fn save(&self, all: &HashMap<String, String>) -> Result<(), String> {
        crate::write(&self.path, all).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

impl SecretStore for FileSecrets {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.all().remove(account))
    }
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        let mut all = self.all();
        all.insert(account.to_string(), value.to_string());
        self.save(&all)
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        let mut all = self.all();
        if all.remove(account).is_some() {
            self.save(&all)?;
        }
        Ok(())
    }
}

pub fn account(collection: &str, environment_id: &str, var_id: &str) -> String {
    format!("{collection}/{environment_id}/{var_id}")
}

/// Store a Secret value; an empty value clears it.
pub fn set_secret(
    store: &dyn SecretStore,
    collection: &str,
    environment_id: &str,
    var_id: &str,
    value: &str,
) -> Result<(), String> {
    let a = account(collection, environment_id, var_id);
    if value.is_empty() {
        store.delete(&a)
    } else {
        store.set(&a, value)
    }
}

/// Variables of an Environment for the runner: plain values from the file, Secrets from the store
/// (any value in the file is ignored). Unfilled Secrets are left out.
pub fn environment_vars(store: &dyn SecretStore, collection: &str, env: &EnvironmentItem) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    for v in &env.variables {
        if v.secret {
            if let Ok(Some(value)) = store.get(&account(collection, &env.id, &v.id)) {
                vars.insert(v.key.clone(), value);
            }
        } else {
            vars.insert(v.key.clone(), v.value.clone());
        }
    }
    vars
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct MissingSecret {
    pub environment_id: String,
    pub environment_name: String,
    pub var_id: String,
    pub key: String,
}

/// This person's Secret values of an Environment by variable id (unfilled Secrets left out), shown in
/// its tab so they can be read and changed there.
pub fn secret_values(store: &dyn SecretStore, collection: &str, env: &EnvironmentItem) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    for v in env.variables.iter().filter(|v| v.secret) {
        if let Some(s) = store.get(&account(collection, &env.id, &v.id))?.filter(|s| !s.is_empty()) {
            out.insert(v.id.clone(), s);
        }
    }
    Ok(out)
}

/// Secrets this person has not filled in yet, in Environment then variable order.
pub fn missing_secrets(store: &dyn SecretStore, collection: &str, data: &CollectionData) -> Vec<MissingSecret> {
    let mut out = Vec::new();
    for env in &data.environments {
        for v in env.variables.iter().filter(|v| v.secret) {
            let filled = matches!(store.get(&account(collection, &env.id, &v.id)), Ok(Some(s)) if !s.is_empty());
            if !filled {
                out.push(MissingSecret {
                    environment_id: env.id.clone(),
                    environment_name: env.name.clone(),
                    var_id: v.id.clone(),
                    key: v.key.clone(),
                });
            }
        }
    }
    out
}

/// Delete every Secret of a Collection (used when the Collection is removed from this machine).
pub fn delete_collection_secrets(store: &dyn SecretStore, collection: &str, data: &CollectionData) -> Result<(), String> {
    for env in &data.environments {
        for v in env.variables.iter().filter(|v| v.secret) {
            store.delete(&account(collection, &env.id, &v.id))?;
        }
    }
    Ok(())
}
