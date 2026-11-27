use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct GitOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error("git executable not found")]
    NotFound,
    #[error("failed to run git: {0}")]
    Io(String),
}

/// The only place the system `git` process is touched. Everything else in
/// this crate speaks to git through this interface.
pub trait GitRunner {
    fn run(&self, cwd: Option<&Path>, args: &[&str]) -> Result<GitOutput, RunError>;
}

/// Runs the `git` found on PATH. Never prompts on the terminal (a missing
/// credential must fail fast, not hang the app).
#[derive(Debug, Clone, Default)]
pub struct SystemGit {
    env: Vec<(String, String)>,
}

impl SystemGit {
    pub fn new() -> Self {
        Self::default()
    }
    /// Extra environment for every git call (used by tests to isolate config).
    pub fn with_env(mut self, key: &str, value: &str) -> Self {
        self.env.push((key.into(), value.into()));
        self
    }
}

/// A lock file left by another git process (an IDE, a terminal) usually goes away within moments.
const LOCK_RETRIES: u32 = 15;
const LOCK_WAIT: std::time::Duration = std::time::Duration::from_millis(200);

/// git's "Unable to create '.../index.lock': File exists" (also ref and config locks).
fn is_lock_busy(stderr: &str) -> bool {
    stderr.contains(".lock") && stderr.contains("File exists")
}

impl GitRunner for SystemGit {
    /// Retries for up to ~3 s while another git process holds a lock in the repository.
    fn run(&self, cwd: Option<&Path>, args: &[&str]) -> Result<GitOutput, RunError> {
        let mut out = self.run_once(cwd, args)?;
        for _ in 0..LOCK_RETRIES {
            if out.success || !is_lock_busy(&out.stderr) {
                break;
            }
            std::thread::sleep(LOCK_WAIT);
            out = self.run_once(cwd, args)?;
        }
        Ok(out)
    }
}

impl SystemGit {
    fn run_once(&self, cwd: Option<&Path>, args: &[&str]) -> Result<GitOutput, RunError> {
        let mut cmd = Command::new("git");
        cmd.args(args).env("GIT_TERMINAL_PROMPT", "0");
        for (k, v) in &self.env {
            cmd.env(k, v);
        }
        if let Some(c) = cwd {
            cmd.current_dir(c);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // git.exe is a console program; without this Windows opens a
            // console window for every call made from the GUI app.
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let out = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                RunError::NotFound
            } else {
                RunError::Io(e.to_string())
            }
        })?;
        Ok(GitOutput {
            success: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }
}
