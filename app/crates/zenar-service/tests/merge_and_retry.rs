mod common;
use common::*;
use zenar_format::RequestItem;
use zenar_service::{Change, SaveOutcome};

/// Both members hold the same saved Request; returns (A's saved copy, B's synced copy).
fn shared(w: &World, r: RequestItem) -> (RequestItem, RequestItem) {
    let SaveOutcome::Saved { request: Some(a), .. } = w.a.service().save(Change::Create(r)).unwrap() else { panic!() };
    let b = w.b.service().sync().unwrap().data.requests.into_iter().find(|x| x.id == a.id).unwrap();
    (a, b)
}

fn saved(out: SaveOutcome) -> RequestItem {
    match out {
        SaveOutcome::Saved { request: Some(r), .. } => r,
        other => panic!("{other:?}"),
    }
}

#[test]
fn non_overlapping_field_edits_merge_without_conflict() {
    let w = world();
    let (a, b) = shared(&w, req("r1", "Login", ""));
    // A changes the URL and saves.
    let mut a2 = a.clone();
    a2.url = "https://a.io".into();
    w.a.service().save(Change::Update { base: a.clone(), ours: a2 }).unwrap();
    // B (never synced) adds a header and saves: Save fetches, merges by Field, pushes.
    let mut b2 = b.clone();
    b2.headers.push(header("h1", "X-B", "1"));
    let m = saved(w.b.service().save(Change::Update { base: b, ours: b2 }).unwrap());
    assert_eq!(m.url, "https://a.io");
    assert_eq!(m.headers.len(), 1);
    assert_eq!(w.b.git_out(&["log", "-1", "--format=%s"]).trim(), "Update \"Login\"");

    let seen = w.a.service().sync().unwrap().data.requests;
    assert_eq!(seen[0].url, "https://a.io");
    assert_eq!(seen[0].headers[0].key, "X-B");
}

#[test]
fn same_field_edit_is_a_conflict_and_writes_nothing() {
    let w = world();
    let (a, b) = shared(&w, req("r1", "Login", ""));
    let mut a2 = a.clone();
    a2.url = "https://a.io".into();
    w.a.service().save(Change::Update { base: a.clone(), ours: a2 }).unwrap();
    let mut b2 = b.clone();
    b2.url = "https://b.io".into();
    let out = w.b.service().save(Change::Update { base: b, ours: b2 }).unwrap();
    let SaveOutcome::Conflict { conflicts, theirs } = out else { panic!("{out:?}") };
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].field, "url");
    assert_eq!(theirs.unwrap().url, "https://a.io");
    assert_eq!(w.b.git_out(&["status", "--porcelain"]), "");
    assert_eq!(w.b.git_out(&["log", "-1", "--format=%s"]).trim(), "Update \"Login\"");
}

#[test]
fn rename_move_and_delete_commit_messages_and_paths() {
    let w = world();
    let (a, _) = shared(&w, req("r1", "Login", ""));
    let mut renamed = a.clone();
    renamed.name = "Sign in".into();
    let a = saved(w.a.service().save(Change::Update { base: a, ours: renamed }).unwrap());
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%s"]).trim(), "Rename \"Sign in\"");
    assert!(w.a.root.join("sign-in.yaml").exists() && !w.a.root.join("login.yaml").exists());

    let mut moved = a.clone();
    moved.folder = "auth/v1".into();
    let a = saved(w.a.service().save(Change::Update { base: a, ours: moved }).unwrap());
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%s"]).trim(), "Move \"Sign in\" (auth/v1/)");
    assert_eq!(a.path, "auth/v1/sign-in.yaml");
    assert!(!w.a.root.join("sign-in.yaml").exists());

    let r = w.b.service().sync().unwrap();
    assert_eq!(r.data.requests[0].path, "auth/v1/sign-in.yaml");

    w.a.service().save(Change::Delete { base: a }).unwrap();
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%s"]).trim(), "Delete \"Sign in\" (auth/v1/)");
    assert!(w.b.service().sync().unwrap().data.requests.is_empty());
}

#[test]
fn rename_by_one_and_edit_by_other_recomputes_path_from_merged_name() {
    let w = world();
    let (a, b) = shared(&w, req("r1", "Login", ""));
    let mut renamed = a.clone();
    renamed.name = "Sign in".into();
    w.a.service().save(Change::Update { base: a, ours: renamed }).unwrap();
    let mut b2 = b.clone();
    b2.method = "POST".into();
    let m = saved(w.b.service().save(Change::Update { base: b, ours: b2 }).unwrap());
    assert_eq!((m.name.as_str(), m.method.as_str(), m.path.as_str()), ("Sign in", "POST", "sign-in.yaml"));
    assert!(!w.b.root.join("login.yaml").exists());
}

#[test]
fn edit_vs_remote_delete_is_a_conflict() {
    let w = world();
    let (a, b) = shared(&w, req("r1", "Login", ""));
    w.a.service().save(Change::Delete { base: a }).unwrap();
    let mut b2 = b.clone();
    b2.url = "https://b.io".into();
    let out = w.b.service().save(Change::Update { base: b, ours: b2 }).unwrap();
    assert!(matches!(out, SaveOutcome::Conflict { theirs: None, .. }));
}

/// Real git, but Member B sneaks a Save in right before A's first push (a lost race).
struct RacingGit<'a> {
    inner: &'a zenar_git::SystemGit,
    race: std::cell::RefCell<Option<Box<dyn FnOnce() + 'a>>>,
    pushes: std::cell::Cell<usize>,
}
impl zenar_git::GitRunner for RacingGit<'_> {
    fn run(&self, cwd: Option<&std::path::Path>, args: &[&str]) -> Result<zenar_git::GitOutput, zenar_git::RunError> {
        if args.first() == Some(&"push") {
            self.pushes.set(self.pushes.get() + 1);
            if let Some(f) = self.race.borrow_mut().take() {
                f();
            }
        }
        self.inner.run(cwd, args)
    }
}

#[test]
fn rejected_push_is_retried_after_merging_the_newer_remote() {
    let w = world();
    let (a, b) = shared(&w, req("r1", "Login", ""));
    let b_svc = w.b.service();
    let racing = RacingGit {
        inner: &w.a.git,
        pushes: Default::default(),
        race: std::cell::RefCell::new(Some(Box::new(|| {
            let mut b2 = b.clone();
            b2.headers.push(header("h1", "X-B", "1"));
            b_svc.save(Change::Update { base: b.clone(), ours: b2 }).unwrap();
        }))),
    };
    let mut a2 = a.clone();
    a2.url = "https://a.io".into();
    let m = saved(w.a.service_with(&racing).save(Change::Update { base: a, ours: a2 }).unwrap());
    assert_eq!(racing.pushes.get(), 2);
    assert_eq!((m.url.as_str(), m.headers.len()), ("https://a.io", 1));
    // init + create + B's update + A's update: one commit per Save, no merge commits
    assert_eq!(w.a.git_out(&["rev-list", "--count", "HEAD"]).trim(), "4");
    assert_eq!(w.a.git_out(&["status", "--porcelain"]), "");
}

#[test]
fn push_refused_by_remote_keeps_clone_at_remote_tip() {
    let w = world();
    let (a, _) = shared(&w, req("r1", "Login", ""));
    let before = w.a.git_out(&["rev-parse", "HEAD"]);
    // The remote refuses every push (like a Viewer without write access).
    let hook = w.bare.join("hooks/pre-receive");
    std::fs::write(&hook, "#!/bin/sh\necho denied >&2\nexit 1\n").unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let mut a2 = a.clone();
    a2.url = "https://a.io".into();
    let err = w.a.service().save(Change::Update { base: a, ours: a2 }).unwrap_err();
    assert!(matches!(err, zenar_service::ServiceError::PushFailed(_)), "{err}");
    assert_eq!(w.a.git_out(&["rev-parse", "HEAD"]), before);
    assert_eq!(w.a.git_out(&["status", "--porcelain"]), "");
}
