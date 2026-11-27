mod common;
use common::*;
use zenar_format::RequestItem;
use zenar_service::{Change, SaveOutcome};

/// Both hold "Login"; A saves url=a.io + header; B (stale) edits url=b.io + method.
fn conflicted() -> (World, RequestItem, RequestItem) {
    let w = world();
    let SaveOutcome::Saved { request: Some(a), .. } = w.a.service().save(Change::Create(req("r1", "Login", ""))).unwrap() else { panic!() };
    let b = w.b.service().sync().unwrap().data.requests.remove(0);
    let mut a2 = a.clone();
    a2.url = "https://a.io".into();
    a2.headers.push(header("h1", "X-A", "1"));
    w.a.service().save(Change::Update { base: a, ours: a2 }).unwrap();
    let mut b2 = b.clone();
    b2.url = "https://b.io".into();
    b2.method = "POST".into();
    (w, b, b2)
}

#[test]
fn conflict_info_names_author_and_time_of_their_version() {
    let (w, base, ours) = conflicted();
    let info = w.b.service().conflict_info(&Change::Update { base, ours }).unwrap();
    assert_eq!(info.theirs_author.as_deref(), Some("Member A"));
    assert!(info.theirs_time.as_deref().unwrap_or("").contains('T'));
    assert_eq!(info.theirs.unwrap().url, "https://a.io");
}

#[test]
fn overwrite_keeps_ours_on_conflict_and_their_other_changes_on_top_of_remote() {
    let (w, base, ours) = conflicted();
    let tip_before = w.a.git_out(&["rev-parse", "HEAD"]);
    let SaveOutcome::Saved { request: Some(m), commit: Some(c) } =
        w.b.service().overwrite(Change::Update { base, ours }).unwrap() else { panic!() };
    assert_eq!(m.url, "https://b.io"); // conflicting Field: mine
    assert_eq!(m.method, "POST");
    assert_eq!(m.headers.len(), 1); // their non-conflicting change kept
    assert_eq!(w.b.git_out(&["log", "-1", "--format=%s"]).trim(), "Overwrite \"Login\" over changes by Member A");
    // History not rewritten: previous remote tip is the parent.
    assert_eq!(w.b.git_out(&["rev-parse", "HEAD^"]), tip_before);
    assert_eq!(w.b.git_out(&["rev-parse", "HEAD"]).trim(), c);
    // Remote equals clone; A sees mine.
    let seen = w.a.service().sync().unwrap().data.requests;
    assert_eq!(seen[0].url, "https://b.io");
    assert_eq!(seen[0].headers[0].key, "X-A");
    assert_eq!(w.a.git_out(&["rev-list", "--count", "HEAD"]).trim(), "4");
}

#[test]
fn overwrite_after_their_delete_recreates_my_version() {
    let w = world();
    let SaveOutcome::Saved { request: Some(a), .. } = w.a.service().save(Change::Create(req("r1", "Login", ""))).unwrap() else { panic!() };
    let b = w.b.service().sync().unwrap().data.requests.remove(0);
    w.a.service().save(Change::Delete { base: a }).unwrap();
    let mut b2 = b.clone();
    b2.url = "https://b.io".into();
    let SaveOutcome::Saved { request: Some(m), .. } = w.b.service().overwrite(Change::Update { base: b, ours: b2 }).unwrap() else { panic!() };
    assert_eq!(m.url, "https://b.io");
    assert!(w.b.root.join("login.yaml").exists());
}

#[test]
fn cancel_takes_remote_and_keeps_my_changes_as_a_draft() {
    let (w, base, ours) = conflicted();
    let remote_tip = w.a.git_out(&["rev-parse", "HEAD"]);
    let d = w.b.service().cancel(&Change::Update { base, ours }).unwrap().unwrap();
    assert_eq!(d.draft.url, "https://b.io");
    assert_eq!(d.base.unwrap().url, "https://a.io"); // rebased onto remote so it is no longer stale
    assert_eq!(w.b.git_out(&["rev-parse", "HEAD"]), remote_tip);
    assert_eq!(w.b.git_out(&["status", "--porcelain"]), "");
    let stored = w.b.service().drafts().get("r1").unwrap().unwrap();
    assert_eq!(stored.draft.url, "https://b.io");
    // Nothing was pushed; remote untouched (create + A's update, plus the initial commit).
    assert_eq!(w.a.git_out(&["rev-list", "--count", "HEAD"]).trim(), "3");
}
