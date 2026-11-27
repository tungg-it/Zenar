//! Local-only Draft store. Lives outside the repo (ADR 0001): a YAML file in the app's store dir.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zenar_format::RequestItem;

use crate::ServiceError;

/// Unsaved changes of one Request, only on this machine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct Draft {
    pub request_id: String,
    /// The version the user started from; `None` for a Request that was never saved.
    pub base: Option<RequestItem>,
    /// The user's edited version.
    pub draft: RequestItem,
    /// The remote changed this Request after `base` (set by sync).
    #[serde(default)]
    pub remote_changed: bool,
}

#[derive(Debug, Clone)]
pub struct DraftStore {
    file: PathBuf,
}

impl DraftStore {
    pub fn new(dir: &Path) -> Self {
        DraftStore { file: dir.join("drafts.yaml") }
    }

    /// The local store directory (also holds the offline queue, Needs Attention and Viewer marker).
    pub(crate) fn dir(&self) -> &Path {
        self.file.parent().unwrap_or(Path::new("."))
    }

    pub fn load(&self) -> Result<Vec<Draft>, ServiceError> {
        if !self.file.is_file() {
            return Ok(vec![]);
        }
        let text = fs::read_to_string(&self.file)?;
        serde_yaml::from_str(&text).map_err(|e| ServiceError::Store(e.to_string()))
    }

    pub fn store(&self, drafts: &[Draft]) -> Result<(), ServiceError> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir)?;
        }
        let text = serde_yaml::to_string(drafts).map_err(|e| ServiceError::Store(e.to_string()))?;
        // Write then rename so a crash never leaves a half-written store.
        let tmp = self.file.with_extension("yaml.tmp");
        fs::write(&tmp, text)?;
        fs::rename(&tmp, &self.file)?;
        Ok(())
    }

    /// Insert or replace the Draft of `request_id`, keeping the original base if one exists.
    pub fn put(&self, request_id: &str, base: Option<RequestItem>, draft: RequestItem) -> Result<(), ServiceError> {
        let mut all = self.load()?;
        match all.iter_mut().find(|d| d.request_id == request_id) {
            Some(d) => d.draft = draft,
            None => all.push(Draft { request_id: request_id.to_string(), base, draft, remote_changed: false }),
        }
        self.store(&all)
    }

    pub fn get(&self, request_id: &str) -> Result<Option<Draft>, ServiceError> {
        Ok(self.load()?.into_iter().find(|d| d.request_id == request_id))
    }

    pub fn remove(&self, request_id: &str) -> Result<(), ServiceError> {
        let mut all = self.load()?;
        all.retain(|d| d.request_id != request_id);
        self.store(&all)
    }
}
