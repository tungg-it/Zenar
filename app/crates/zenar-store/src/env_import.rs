//! Importing an environment file (ticket #24). A file matching an Environment of the Collection
//! only fills this person's Secrets (Secret store, no Save): the repo stays the source of truth for
//! shared values and for which variables are Secrets. A file matching nothing becomes a new
//! Environment, which the caller Saves for every Member.

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use zenar_format::env_file::EnvFile;
use zenar_format::{CollectionData, EnvVar, EnvironmentItem};

use crate::secrets::{account, set_secret, SecretStore};

/// Where the person wants the file to go. `Auto` matches by id, then by name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TargetChoice {
    Auto,
    Existing { environment_id: String },
    New,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ImportTarget {
    Existing { environment_id: String, environment_name: String },
    /// Secret variables carry their value in `value`, as `save_environment` expects.
    New { environment: EnvironmentItem },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct SecretFill {
    pub var_id: String,
    pub key: String,
    pub value: String,
    /// A different value is already stored on this machine.
    pub overwrites: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum SkipReason {
    /// A plain variable of an existing Environment: its value comes from the repo.
    Shared,
    /// The Environment has no variable with this key.
    NotInEnvironment,
    /// Turned off in Postman; Zenar has no disabled variables.
    Disabled,
    /// A Secret with no value in the file.
    NoValue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct SkippedVar {
    pub key: String,
    pub reason: SkipReason,
}

/// What importing a file will do, shown before anything is written.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct EnvImportPlan {
    pub target: ImportTarget,
    pub fills: Vec<SecretFill>,
    pub skipped: Vec<SkippedVar>,
}

/// Plan the import of `file` into a Collection. `fallback_name` names a new Environment when the
/// file has no name (`.env`). Reads the Secret store to flag overwrites; writes nothing.
pub fn plan_environment_import(
    store: &dyn SecretStore,
    collection: &str,
    data: &CollectionData,
    file: &EnvFile,
    choice: &TargetChoice,
    fallback_name: &str,
    new_id: &mut dyn FnMut() -> String,
) -> EnvImportPlan {
    let by_id = |id: &str| data.environments.iter().find(|e| e.id == id);
    let matched = match choice {
        TargetChoice::New => None,
        TargetChoice::Existing { environment_id } => by_id(environment_id),
        TargetChoice::Auto => file
            .id
            .as_deref()
            .and_then(by_id)
            .or_else(|| file.name.as_deref().and_then(|n| data.environments.iter().find(|e| e.name == n.trim()))),
    };
    match matched {
        Some(env) => into_existing(store, collection, env, file),
        None => into_new(data, file, fallback_name, new_id),
    }
}

fn into_existing(store: &dyn SecretStore, collection: &str, env: &EnvironmentItem, file: &EnvFile) -> EnvImportPlan {
    let mut fills = Vec::new();
    let mut skipped = Vec::new();
    for fv in file.variables.iter().filter(|v| !v.key.is_empty()) {
        let skip = |reason| SkippedVar { key: fv.key.clone(), reason };
        // Whether a variable is a Secret is the team's decision (repo), whatever the file says.
        match env.variables.iter().find(|v| v.key == fv.key) {
            None => skipped.push(skip(SkipReason::NotInEnvironment)),
            Some(_) if !fv.enabled => skipped.push(skip(SkipReason::Disabled)),
            Some(v) if !v.secret => skipped.push(skip(SkipReason::Shared)),
            Some(_) if fv.value.is_empty() => skipped.push(skip(SkipReason::NoValue)),
            Some(v) => {
                let stored = store.get(&account(collection, &env.id, &v.id)).ok().flatten().unwrap_or_default();
                fills.push(SecretFill {
                    var_id: v.id.clone(),
                    key: v.key.clone(),
                    value: fv.value.clone(),
                    overwrites: !stored.is_empty() && stored != fv.value,
                });
            }
        }
    }
    let target = ImportTarget::Existing { environment_id: env.id.clone(), environment_name: env.name.clone() };
    EnvImportPlan { target, fills, skipped }
}

fn into_new(data: &CollectionData, file: &EnvFile, fallback_name: &str, new_id: &mut dyn FnMut() -> String) -> EnvImportPlan {
    let mut variables = Vec::new();
    let mut fills = Vec::new();
    let mut skipped = Vec::new();
    for fv in file.variables.iter().filter(|v| !v.key.is_empty()) {
        if !fv.enabled {
            skipped.push(SkippedVar { key: fv.key.clone(), reason: SkipReason::Disabled });
            continue;
        }
        let id = new_id();
        if fv.secret && !fv.value.is_empty() {
            fills.push(SecretFill { var_id: id.clone(), key: fv.key.clone(), value: fv.value.clone(), overwrites: false });
        }
        variables.push(EnvVar { id, key: fv.key.clone(), value: fv.value.clone(), secret: fv.secret, extra: None });
    }
    let name = file.name.as_deref().map(str::trim).filter(|n| !n.is_empty()).unwrap_or(fallback_name).to_string();
    let order = data.environments.iter().map(|e| e.order).fold(0.0, f64::max) + 1.0;
    let environment = EnvironmentItem { id: new_id(), name, order, variables, path: String::new(), extra: None };
    EnvImportPlan { target: ImportTarget::New { environment }, fills, skipped }
}

/// Write the planned Secret values of an import into an existing Environment to the Secret store.
/// A new Environment is not written here: the caller Saves it (its Secrets are stored there).
pub fn apply_environment_import(store: &dyn SecretStore, collection: &str, plan: &EnvImportPlan) -> Result<(), String> {
    let ImportTarget::Existing { environment_id, .. } = &plan.target else {
        return Err("a new Environment is created by saving it".into());
    };
    for f in &plan.fills {
        set_secret(store, collection, environment_id, &f.var_id, &f.value)?;
    }
    Ok(())
}
