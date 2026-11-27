use std::path::Path;
use zenar_git::{check_environment, EnvError, GitOutput, GitRunner, RunError, SystemGit};

struct Fake {
    version: Result<&'static str, ()>,
    helper: &'static str,
}

impl GitRunner for Fake {
    fn run(&self, _: Option<&Path>, args: &[&str]) -> Result<GitOutput, RunError> {
        let ok = |s: &str| Ok(GitOutput { success: !s.is_empty(), stdout: s.into(), stderr: String::new() });
        match args[0] {
            "--version" => match self.version {
                Ok(v) => ok(v),
                Err(()) => Err(RunError::NotFound),
            },
            _ => ok(self.helper),
        }
    }
}

#[test]
fn missing_git_gives_install_steps() {
    let e = check_environment(&Fake { version: Err(()), helper: "" }).unwrap_err();
    assert_eq!(e, EnvError::GitMissing);
    assert!(e.to_string().contains("Install Git"));
}

#[test]
fn old_git_rejected() {
    let e = check_environment(&Fake { version: Ok("git version 2.20.1\n"), helper: "x" }).unwrap_err();
    assert!(matches!(e, EnvError::GitTooOld { .. }));
}

#[test]
fn apple_style_version_string_parses() {
    let r = check_environment(&Fake { version: Ok("git version 2.39.5 (Apple Git-154)\n"), helper: "osxkeychain\n" });
    assert_eq!(r.unwrap().git_version, "2.39");
}

#[test]
fn no_credential_helper_gives_signin_steps() {
    let e = check_environment(&Fake { version: Ok("git version 2.40.0\n"), helper: "" }).unwrap_err();
    assert_eq!(e, EnvError::NoCredentials);
    assert!(e.to_string().contains("Steps"));
}

#[test]
fn real_git_with_isolated_config() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = dir.path().join("gitconfig");
    std::fs::write(&cfg, "").unwrap();
    let git = SystemGit::new()
        .with_env("GIT_CONFIG_GLOBAL", cfg.to_str().unwrap())
        .with_env("GIT_CONFIG_NOSYSTEM", "1");
    assert_eq!(check_environment(&git).unwrap_err(), EnvError::NoCredentials);
    std::fs::write(&cfg, "[credential]\n\thelper = store\n").unwrap();
    assert!(check_environment(&git).is_ok());
}
