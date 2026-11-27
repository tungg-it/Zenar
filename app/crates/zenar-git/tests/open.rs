use std::path::{Path, PathBuf};
use std::process::Command;
use zenar_git::{open_collection_from_remote, open_collection_from_url, Author, OpenKind, OpenRepoError, SystemGit};

struct Env {
    dir: tempfile::TempDir,
    git: SystemGit,
}

impl Env {
    fn new(with_author: bool) -> Env {
        let dir = tempfile::tempdir().unwrap();
        let cfg = dir.path().join("gitconfig");
        let body = if with_author { "[user]\n\tname = Ann\n\temail = ann@x.io\n" } else { "" };
        std::fs::write(&cfg, body).unwrap();
        let git = SystemGit::new()
            .with_env("GIT_CONFIG_GLOBAL", cfg.to_str().unwrap())
            .with_env("GIT_CONFIG_NOSYSTEM", "1");
        Env { dir, git }
    }
    fn p(&self, n: &str) -> PathBuf {
        self.dir.path().join(n)
    }
    fn bare(&self) -> PathBuf {
        let b = self.p("remote.git");
        sh(self.dir.path(), &["init", "-q", "--bare", b.to_str().unwrap()]);
        b
    }
    /// Seed the bare repo with the given files via a scratch clone.
    fn seed(&self, bare: &Path, files: &[(&str, &str)]) {
        let w = self.p("seed");
        sh(self.dir.path(), &["clone", "-q", bare.to_str().unwrap(), w.to_str().unwrap()]);
        for (n, c) in files {
            std::fs::write(w.join(n), c).unwrap();
        }
        sh(&w, &["add", "-A"]);
        sh(&w, &["-c", "user.name=Seed", "-c", "user.email=s@x.io", "commit", "-q", "-m", "seed"]);
        sh(&w, &["push", "-q", "origin", "HEAD"]);
    }
    fn gitc(&self, dir: &Path, args: &[&str]) -> String {
        let cfg = self.p("gitconfig");
        let o = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", cfg)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        String::from_utf8_lossy(&o.stdout).into_owned()
    }
}

fn sh(dir: &Path, args: &[&str]) {
    let o = Command::new("git").args(args).current_dir(dir).output().unwrap();
    assert!(o.status.success(), "{args:?}: {}", String::from_utf8_lossy(&o.stderr));
}

fn no_prompt() -> impl FnMut() -> Option<Author> {
    || panic!("should not prompt")
}

#[test]
fn empty_repo_is_initialized_and_pushed() {
    let e = Env::new(true);
    let bare = e.bare();
    let dest = e.p("clone");
    let r = open_collection_from_remote(&e.git, bare.to_str().unwrap(), &dest, &mut no_prompt()).unwrap();
    assert_eq!(r.kind, OpenKind::Initialized);
    assert_eq!(r.data.name, "remote");
    assert!(dest.join("collection.yaml").exists());
    assert!(dest.join(".gitignore").exists());
    // pushed: a fresh clone sees the files, authored from git config
    let verify = e.p("verify");
    sh(e.dir.path(), &["clone", "-q", bare.to_str().unwrap(), verify.to_str().unwrap()]);
    assert!(verify.join("collection.yaml").exists());
    assert_eq!(e.gitc(&verify, &["log", "-1", "--format=%an <%ae>"]).trim(), "Ann <ann@x.io>");
}

#[test]
fn existing_collection_is_opened_without_changes() {
    let e = Env::new(true);
    let bare = e.bare();
    e.seed(&bare, &[("collection.yaml", "formatVersion: 1\nname: Shop\n")]);
    let dest = e.p("clone");
    let r = open_collection_from_remote(&e.git, bare.to_str().unwrap(), &dest, &mut no_prompt()).unwrap();
    assert_eq!(r.kind, OpenKind::Opened);
    assert_eq!(r.data.name, "Shop");
    assert_eq!(e.gitc(&dest, &["rev-list", "--count", "HEAD"]).trim(), "1");
}

#[test]
fn foreign_repo_is_refused_untouched_with_steps() {
    let e = Env::new(true);
    let bare = e.bare();
    e.seed(&bare, &[("README.md", "hello")]);
    let dest = e.p("clone");
    let err = open_collection_from_remote(&e.git, bare.to_str().unwrap(), &dest, &mut no_prompt()).unwrap_err();
    assert!(matches!(err, OpenRepoError::ForeignContent));
    assert!(err.to_string().contains("empty"));
    // remote has no collection.yaml and no extra commit; local clone cleaned up
    assert_eq!(e.gitc(&bare, &["rev-list", "--count", "HEAD"]).trim(), "1");
    assert!(e.gitc(&bare, &["ls-tree", "--name-only", "HEAD"]).trim() == "README.md");
    assert!(!dest.exists());
}

#[test]
fn author_prompted_once_when_missing_then_remembered() {
    let e = Env::new(false);
    let bare = e.bare();
    let mut asked = 0;
    let mut prompt = || {
        asked += 1;
        Some(Author { name: "Bob".into(), email: "bob@x.io".into() })
    };
    open_collection_from_remote(&e.git, bare.to_str().unwrap(), &e.p("c1"), &mut prompt).unwrap();
    assert_eq!(asked, 1);
    let verify = e.p("verify");
    sh(e.dir.path(), &["clone", "-q", bare.to_str().unwrap(), verify.to_str().unwrap()]);
    assert_eq!(e.gitc(&verify, &["log", "-1", "--format=%an"]).trim(), "Bob");
    // remembered per clone, never in the user's global git config
    assert_eq!(e.gitc(&e.p("c1"), &["config", "--local", "user.name"]).trim(), "Bob");
    assert!(std::fs::read_to_string(e.p("gitconfig")).unwrap().is_empty());
}

#[test]
fn opening_an_existing_collection_without_an_author_asks_for_one() {
    let e = Env::new(false);
    let bare = e.bare();
    e.seed(&bare, &[("collection.yaml", "formatVersion: 1\nname: Shop\n")]);
    let err = open_collection_from_remote(&e.git, bare.to_str().unwrap(), &e.p("c"), &mut || None).unwrap_err();
    assert!(matches!(err, OpenRepoError::AuthorRequired));
    assert!(!e.p("c").exists());

    let mut prompt = || Some(Author { name: "Bob".into(), email: "bob@x.io".into() });
    let r = open_collection_from_remote(&e.git, bare.to_str().unwrap(), &e.p("c"), &mut prompt).unwrap();
    assert_eq!(r.kind, OpenKind::Opened);
    assert_eq!(e.gitc(&e.p("c"), &["config", "user.email"]).trim(), "bob@x.io");
    assert!(!zenar_git::author_missing(&e.git, &e.p("c")).unwrap());
}

#[test]
fn declined_author_prompt_aborts_without_push() {
    let e = Env::new(false);
    let bare = e.bare();
    let err = open_collection_from_remote(&e.git, bare.to_str().unwrap(), &e.p("c"), &mut || None).unwrap_err();
    assert!(matches!(err, OpenRepoError::AuthorRequired));
    assert!(e.gitc(&bare, &["rev-list", "--all", "--count"]).trim() == "0");
}

#[test]
fn ssh_url_rejected_before_any_git_call() {
    let e = Env::new(true);
    let err = open_collection_from_url(&e.git, "git@github.com:a/b.git", &e.p("c"), &mut no_prompt()).unwrap_err();
    assert!(err.to_string().contains("https://github.com/a/b.git"));
    assert!(!e.p("c").exists());
}

#[test]
fn clone_failure_reports_steps() {
    let e = Env::new(true);
    let err = open_collection_from_remote(&e.git, e.p("nope.git").to_str().unwrap(), &e.p("c"), &mut no_prompt())
        .unwrap_err();
    assert!(matches!(err, OpenRepoError::CloneFailed { .. }));
    assert!(err.to_string().contains("Steps"));
}

#[test]
fn existing_non_empty_destination_is_refused() {
    let e = Env::new(true);
    let bare = e.bare();
    std::fs::create_dir(e.p("c")).unwrap();
    std::fs::write(e.p("c/x"), "1").unwrap();
    let err = open_collection_from_remote(&e.git, bare.to_str().unwrap(), &e.p("c"), &mut no_prompt()).unwrap_err();
    assert!(matches!(err, OpenRepoError::DestinationExists(_)));
}

#[test]
fn rejected_push_leaves_files_and_reports() {
    let e = Env::new(true);
    let bare = e.bare();
    // simulate a Viewer: server refuses all pushes
    let hook = bare.join("hooks/pre-receive");
    std::fs::write(&hook, "#!/bin/sh\necho denied >&2\nexit 1\n").unwrap();
    Command::new("chmod").args(["+x", hook.to_str().unwrap()]).status().unwrap();
    let err = open_collection_from_remote(&e.git, bare.to_str().unwrap(), &e.p("c"), &mut no_prompt()).unwrap_err();
    assert!(matches!(err, OpenRepoError::PushFailed(_)));
}
