use crate::runner::{GitRunner, RunError};

/// Minimum supported git version (major, minor).
pub const MIN_GIT_VERSION: (u32, u32) = (2, 25);

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum EnvError {
    #[error("Git is not installed. Steps: 1) Install Git from https://git-scm.com/downloads (includes Git Credential Manager on Windows). 2) Restart Zenar.")]
    GitMissing,
    #[error("Git {found} is too old; Zenar needs {min} or newer. Steps: update Git from https://git-scm.com/downloads, then restart Zenar.")]
    GitTooOld { found: String, min: String },
    #[error("Git is not signed in to your host (no credential helper configured). Steps: 1) Install Git Credential Manager (https://github.com/git-ecosystem/git-credential-manager) or enable your OS helper (`git config --global credential.helper osxkeychain`). 2) Run `git clone <your repo HTTPS URL>` once in a terminal and sign in. 3) Retry in Zenar.")]
    NoCredentials,
    #[error("could not run git: {0}")]
    Other(String),
}

#[derive(Debug, PartialEq, Eq)]
pub struct EnvReport {
    pub git_version: String,
}

/// Startup check: git present, new enough, and a credential helper configured.
pub fn check_environment(git: &dyn GitRunner) -> Result<EnvReport, EnvError> {
    let out = match git.run(None, &["--version"]) {
        Ok(o) => o,
        Err(RunError::NotFound) => return Err(EnvError::GitMissing),
        Err(e) => return Err(EnvError::Other(e.to_string())),
    };
    let version = parse_version(&out.stdout).ok_or_else(|| EnvError::Other(out.stdout.clone()))?;
    if (version.0, version.1) < MIN_GIT_VERSION {
        return Err(EnvError::GitTooOld {
            found: format!("{}.{}", version.0, version.1),
            min: format!("{}.{}", MIN_GIT_VERSION.0, MIN_GIT_VERSION.1),
        });
    }
    let cred = git
        .run(None, &["config", "--get-all", "credential.helper"])
        .map_err(|e| EnvError::Other(e.to_string()))?;
    if !cred.success || cred.stdout.trim().is_empty() {
        return Err(EnvError::NoCredentials);
    }
    Ok(EnvReport { git_version: format!("{}.{}", version.0, version.1) })
}

fn parse_version(s: &str) -> Option<(u32, u32)> {
    let v = s.split_whitespace().find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()))?;
    let mut it = v.split('.');
    Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
}
