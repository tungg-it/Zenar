use crate::runner::{GitOutput, GitRunner, RunError};
use crate::url::{parse_remote_url, repo_name_of, UrlError};
use std::fs;
use std::path::Path;
use zenar_format::{init_collection, open_collection, CollectionData};

const GITIGNORE: &str = "# Zenar: local-only files\n.zenar/\n";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Author {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenKind {
    /// Repo was empty: collection.yaml and .gitignore were written and pushed.
    Initialized,
    /// Repo already held a Collection.
    Opened,
}

#[derive(Debug)]
pub struct OpenedRepo {
    pub kind: OpenKind,
    pub data: CollectionData,
}

#[derive(Debug, thiserror::Error)]
pub enum OpenRepoError {
    #[error(transparent)]
    Url(#[from] UrlError),
    #[error("Could not clone the repo. Steps: 1) Check the URL. 2) Make sure you are signed in (run `git clone <url>` in a terminal once). 3) Ask the repo owner for access. Details: {stderr}")]
    CloneFailed { stderr: String },
    #[error("The folder {0} already exists and is not empty. Choose another location.")]
    DestinationExists(String),
    #[error("This repo already has other content, so Zenar will not touch it. Steps: create a new, fully empty repo (no README, no .gitignore, no license) and paste its HTTPS URL.")]
    ForeignContent,
    #[error("Git needs your name and email to record Saves, but none was provided.")]
    AuthorRequired,
    #[error("Could not push to the repo (you may only have read access). Details: {0}")]
    PushFailed(String),
    #[error("git error: {0}")]
    Git(String),
    #[error("collection error: {0}")]
    Format(#[from] zenar_format::OpenError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<RunError> for OpenRepoError {
    fn from(e: RunError) -> Self {
        OpenRepoError::Git(e.to_string())
    }
}

/// Asked for the commit author when git config has none. Return `None` to decline.
pub trait AuthorPrompt {
    fn ask(&mut self) -> Option<Author>;
}
impl<F: FnMut() -> Option<Author>> AuthorPrompt for F {
    fn ask(&mut self) -> Option<Author> {
        self()
    }
}

/// Open a Collection from a pasted URL. Only HTTPS is accepted.
pub fn open_collection_from_url(
    git: &dyn GitRunner,
    url: &str,
    dest: &Path,
    prompt: &mut dyn AuthorPrompt,
) -> Result<OpenedRepo, OpenRepoError> {
    let url = parse_remote_url(url)?;
    open_collection_from_remote(git, url.as_str(), dest, prompt)
}

/// Clone `remote` into `dest`, then decide by content: empty -> initialize and
/// push, valid collection.yaml -> open, anything else -> refuse. Never force pushes.
/// (`remote` is not scheme-checked here; use [`open_collection_from_url`] for user input.)
pub fn open_collection_from_remote(
    git: &dyn GitRunner,
    remote: &str,
    dest: &Path,
    prompt: &mut dyn AuthorPrompt,
) -> Result<OpenedRepo, OpenRepoError> {
    if dest.exists() && fs::read_dir(dest)?.next().is_some() {
        return Err(OpenRepoError::DestinationExists(dest.display().to_string()));
    }
    let dest_str = dest.to_string_lossy();
    let out = git.run(None, &["clone", "--quiet", remote, &dest_str])?;
    if !out.success {
        let _ = fs::remove_dir_all(dest);
        return Err(OpenRepoError::CloneFailed { stderr: out.stderr.trim().to_string() });
    }

    let has_content = fs::read_dir(dest)?
        .filter_map(Result::ok)
        .any(|e| e.file_name() != ".git");
    if !has_content {
        let name = repo_name_of(remote);
        let r = initialize_and_push(git, dest, &name, prompt);
        if matches!(r, Err(OpenRepoError::AuthorRequired)) {
            let _ = fs::remove_dir_all(dest);
        }
        r?;
        return Ok(OpenedRepo { kind: OpenKind::Initialized, data: open_collection(dest)? });
    }
    if dest.join("collection.yaml").is_file() {
        // Every later Save needs an author, so ask now rather than at the first failing Save.
        if let Err(e) = ensure_author(git, dest, prompt) {
            let _ = fs::remove_dir_all(dest);
            return Err(e);
        }
        return Ok(OpenedRepo { kind: OpenKind::Opened, data: open_collection(dest)? });
    }
    let _ = fs::remove_dir_all(dest);
    Err(OpenRepoError::ForeignContent)
}

fn check(out: GitOutput) -> Result<GitOutput, OpenRepoError> {
    if out.success {
        Ok(out)
    } else {
        Err(OpenRepoError::Git(out.stderr.trim().to_string()))
    }
}

fn config_get(git: &dyn GitRunner, repo: &Path, key: &str) -> Result<Option<String>, OpenRepoError> {
    let o = git.run(Some(repo), &["config", "--get", key])?;
    let v = o.stdout.trim().to_string();
    Ok((o.success && !v.is_empty()).then_some(v))
}

/// True when git has no commit author (name and email) for this clone.
pub fn author_missing(git: &dyn GitRunner, repo: &Path) -> Result<bool, OpenRepoError> {
    Ok(config_get(git, repo, "user.name")?.is_none() || config_get(git, repo, "user.email")?.is_none())
}

/// Store the commit author in this clone's own config (never the user's global git config).
pub fn set_author(git: &dyn GitRunner, repo: &Path, a: &Author) -> Result<(), OpenRepoError> {
    if a.name.trim().is_empty() || a.email.trim().is_empty() {
        return Err(OpenRepoError::AuthorRequired);
    }
    check(git.run(Some(repo), &["config", "user.name", a.name.trim()])?)?;
    check(git.run(Some(repo), &["config", "user.email", a.email.trim()])?)?;
    Ok(())
}

/// Author comes from git config; if missing, ask once and store it in this clone's config.
fn ensure_author(git: &dyn GitRunner, repo: &Path, prompt: &mut dyn AuthorPrompt) -> Result<(), OpenRepoError> {
    if !author_missing(git, repo)? {
        return Ok(());
    }
    let a = prompt.ask().ok_or(OpenRepoError::AuthorRequired)?;
    set_author(git, repo, &a)
}

fn initialize_and_push(
    git: &dyn GitRunner,
    repo: &Path,
    name: &str,
    prompt: &mut dyn AuthorPrompt,
) -> Result<(), OpenRepoError> {
    ensure_author(git, repo, prompt)?;
    init_collection(repo, name)?;
    fs::write(repo.join(".gitignore"), GITIGNORE)?;
    check(git.run(Some(repo), &["add", "collection.yaml", ".gitignore"])?)?;
    check(git.run(Some(repo), &["commit", "--quiet", "-m", "Initialize Zenar Collection"])?)?;
    // Plain push, never --force.
    let push = git.run(Some(repo), &["push", "--quiet", "origin", "HEAD"])?;
    if !push.success {
        return Err(OpenRepoError::PushFailed(push.stderr.trim().to_string()));
    }
    Ok(())
}
