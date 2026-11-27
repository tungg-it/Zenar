use std::cell::RefCell;
use std::path::Path;
use std::process::Command;
use zenar_git::{
    open_collection_from_remote, remove_collection, Author, Library, LibraryEntry, LocalDataPurger, RemoveOutcome,
    SystemGit,
};

struct Purger(RefCell<Vec<String>>);
impl LocalDataPurger for Purger {
    fn purge(&self, c: &LibraryEntry) -> Result<(), String> {
        self.0.borrow_mut().push(c.id.clone());
        Ok(())
    }
}

fn sh(dir: &Path, args: &[&str]) {
    let o = Command::new("git").args(args).current_dir(dir).output().unwrap();
    assert!(o.status.success(), "{args:?}: {}", String::from_utf8_lossy(&o.stderr));
}

struct Fixture {
    _dir: tempfile::TempDir,
    git: SystemGit,
    lib: Library,
    entry: LibraryEntry,
}

/// A Collection cloned from an empty bare remote (so it was initialized and pushed).
fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let cfg = dir.path().join("gitconfig");
    std::fs::write(&cfg, "[user]\n\tname = Ann\n\temail = ann@x.io\n").unwrap();
    let git = SystemGit::new()
        .with_env("GIT_CONFIG_GLOBAL", cfg.to_str().unwrap())
        .with_env("GIT_CONFIG_NOSYSTEM", "1");
    let bare = dir.path().join("remote.git");
    sh(dir.path(), &["init", "-q", "--bare", bare.to_str().unwrap()]);
    let mut lib = Library::load(&dir.path().join("collections.json")).unwrap();
    let entry = lib.add("Demo", bare.to_str().unwrap(), dir.path().join("clones")).unwrap();
    open_collection_from_remote(&git, &entry.url, &entry.path, &mut || -> Option<Author> { None }).unwrap();
    Fixture { _dir: dir, git, lib, entry }
}

fn commit_locally(f: &Fixture) {
    std::fs::write(f.entry.path.join("a.yaml"), "x").unwrap();
    sh(&f.entry.path, &["add", "-A"]);
    sh(&f.entry.path, &["-c", "user.name=A", "-c", "user.email=a@x.io", "commit", "-q", "-m", "save"]);
}

#[test]
fn removes_clone_entry_and_local_data_when_everything_is_pushed() {
    let mut f = fixture();
    let purger = Purger(RefCell::new(vec![]));
    let out = remove_collection(&f.git, &mut f.lib, &f.entry.id, &purger, false).unwrap();
    assert_eq!(out, RemoveOutcome::Removed);
    assert!(!f.entry.path.exists());
    assert!(f.lib.list().is_empty());
    assert_eq!(*purger.0.borrow(), vec!["demo".to_string()]);
}

#[test]
fn warns_and_removes_nothing_when_saves_are_unpushed() {
    let mut f = fixture();
    commit_locally(&f);
    let purger = Purger(RefCell::new(vec![]));
    let out = remove_collection(&f.git, &mut f.lib, &f.entry.id, &purger, false).unwrap();
    assert_eq!(out, RemoveOutcome::UnpushedSaves(1));
    assert!(f.entry.path.exists());
    assert_eq!(f.lib.list().len(), 1);
    assert!(purger.0.borrow().is_empty());
}

#[test]
fn confirmed_removal_discards_unpushed_saves() {
    let mut f = fixture();
    commit_locally(&f);
    let purger = Purger(RefCell::new(vec![]));
    let out = remove_collection(&f.git, &mut f.lib, &f.entry.id, &purger, true).unwrap();
    assert_eq!(out, RemoveOutcome::Removed);
    assert!(!f.entry.path.exists());
}
