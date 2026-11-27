#![allow(dead_code)]
//! Two real clones (Member A, Member B) of one real bare repo. No mocks of Git or Format.
use std::path::{Path, PathBuf};
use std::process::Command;
use zenar_format::{KeyValue, RequestItem};
use zenar_git::{open_collection_from_remote, GitRunner, SystemGit};
use zenar_service::CollectionService;

pub struct Member {
    pub git: SystemGit,
    pub root: PathBuf,
    pub store: PathBuf,
    pub cfg: PathBuf,
}

impl Member {
    pub fn service(&self) -> CollectionService<'_> {
        CollectionService::new(&self.git, &self.root, &self.store)
    }
    pub fn service_with<'g>(&self, git: &'g dyn GitRunner) -> CollectionService<'g> {
        CollectionService::new(git, &self.root, &self.store)
    }
    /// Run real git in this member's clone with the member's identity.
    pub fn git_out(&self, args: &[&str]) -> String {
        let o = Command::new("git").args(args).current_dir(&self.root)
            .env("GIT_CONFIG_GLOBAL", &self.cfg).env("GIT_CONFIG_NOSYSTEM", "1").output().unwrap();
        assert!(o.status.success(), "{args:?}: {}", String::from_utf8_lossy(&o.stderr));
        String::from_utf8_lossy(&o.stdout).into_owned()
    }
}

pub struct World {
    pub dir: tempfile::TempDir,
    pub bare: PathBuf,
    pub a: Member,
    pub b: Member,
}

fn member(dir: &Path, bare: &Path, who: &str, email: &str) -> Member {
    let cfg = dir.join(format!("{who}.gitconfig"));
    std::fs::write(&cfg, format!("[user]\n\tname = {who}\n\temail = {email}\n")).unwrap();
    let git = SystemGit::new()
        .with_env("GIT_CONFIG_GLOBAL", cfg.to_str().unwrap())
        .with_env("GIT_CONFIG_NOSYSTEM", "1");
    let root = dir.join(format!("clone-{who}"));
    open_collection_from_remote(&git, bare.to_str().unwrap(), &root, &mut || panic!("no prompt")).unwrap();
    let store = dir.join(format!("store-{who}"));
    Member { git, root, store, cfg }
}

pub fn world() -> World {
    let dir = tempfile::tempdir().unwrap();
    let bare = dir.path().join("remote.git");
    let o = Command::new("git").args(["init", "-q", "--bare", bare.to_str().unwrap()]).output().unwrap();
    assert!(o.status.success());
    let a = member(dir.path(), &bare, "Member A", "a@x.io"); // initializes the Collection
    let b = member(dir.path(), &bare, "Member B", "b@x.io");
    World { dir, bare, a, b }
}

pub fn req(id: &str, name: &str, folder: &str) -> RequestItem {
    RequestItem {
        id: id.into(), name: name.into(), order: 1.0, method: "GET".into(), url: "https://x.io".into(),
        folder: folder.into(), params: vec![], headers: vec![], auth: None, body: None, body_type: None, body_extra: None, path_variables: vec![], captures: vec![], scripts: Default::default(),
        path: String::new(), extra: None,
    }
}

pub fn header(id: &str, k: &str, v: &str) -> KeyValue {
    KeyValue { id: id.into(), key: k.into(), value: v.into(), enabled: true, extra: None }
}
