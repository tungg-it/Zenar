use crate::library::{Library, LibraryEntry, LibraryError};
use crate::runner::{GitRunner, RunError};
use std::fs;
use std::path::Path;

/// Deletes the per-Collection data that lives outside the clone: Drafts,
/// cookies and Secrets. Git credentials are never touched (ADR 0007).
pub trait LocalDataPurger {
    fn purge(&self, collection: &LibraryEntry) -> Result<(), String>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum RemoveOutcome {
    Removed,
    /// Nothing was removed; this many Saves exist only on this machine.
    UnpushedSaves(usize),
}

#[derive(Debug, thiserror::Error)]
pub enum RemoveError {
    #[error("unknown collection: {0}")]
    Unknown(String),
    #[error("git error: {0}")]
    Git(String),
    #[error("could not delete local data: {0}")]
    Purge(String),
    #[error(transparent)]
    Library(#[from] LibraryError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<RunError> for RemoveError {
    fn from(e: RunError) -> Self {
        RemoveError::Git(e.to_string())
    }
}

/// Number of commits in the clone that no remote-tracking branch has.
pub fn unpushed_saves(git: &dyn GitRunner, repo: &Path) -> Result<usize, RunError> {
    let o = git.run(Some(repo), &["rev-list", "--count", "HEAD", "--not", "--remotes"])?;
    // No HEAD (nothing committed) or an unreadable repo: nothing to lose.
    Ok(if o.success { o.stdout.trim().parse().unwrap_or(0) } else { 0 })
}

/// Remove a Collection from this machine. If Saves are unpushed and
/// `confirm_unpushed` is false, nothing is removed and the count is returned.
pub fn remove_collection(
    git: &dyn GitRunner,
    library: &mut Library,
    id: &str,
    purger: &dyn LocalDataPurger,
    confirm_unpushed: bool,
) -> Result<RemoveOutcome, RemoveError> {
    let entry = library.get(id).cloned().ok_or_else(|| RemoveError::Unknown(id.into()))?;
    if !confirm_unpushed && entry.path.exists() {
        let n = unpushed_saves(git, &entry.path)?;
        if n > 0 {
            return Ok(RemoveOutcome::UnpushedSaves(n));
        }
    }
    purger.purge(&entry).map_err(RemoveError::Purge)?;
    if entry.path.exists() {
        fs::remove_dir_all(&entry.path)?;
    }
    library.take(id)?;
    Ok(RemoveOutcome::Removed)
}
