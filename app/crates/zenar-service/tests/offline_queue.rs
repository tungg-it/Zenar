//! Offline queue: Saves made while the remote is unreachable are queued (as Changes in the local
//! store; the clone stays equal to the remote tip) and pushed when back online.
mod common;
use common::*;
use zenar_service::{Change, SaveAttempt, SaveOutcome};

fn set_origin(m: &Member, url: &str) {
    m.git_out(&["remote", "set-url", "origin", url]);
}

fn go_offline(m: &Member) {
    set_origin(m, "http://127.0.0.1:1/nope.git");
}

fn go_online(w: &World, m: &Member) {
    set_origin(m, w.bare.to_str().unwrap());
}

fn seed(w: &World) -> zenar_format::RequestItem {
    let SaveOutcome::Saved { request: Some(a), .. } = w.a.service().save(Change::Create(req("r1", "Login", ""))).unwrap() else { panic!() };
    w.b.service().sync().unwrap();
    a
}

#[test]
fn offline_save_is_queued_and_clone_stays_at_remote_tip() {
    let w = world();
    let base = seed(&w);
    let tip = w.b.git_out(&["rev-parse", "HEAD"]);
    go_offline(&w.b);
    let mut ours = base.clone();
    ours.url = "https://offline.io".into();

    let r = w.b.service().save_or_queue(Change::Update { base, ours }).unwrap();
    assert!(matches!(r, SaveAttempt::Queued), "{r:?}");
    assert_eq!(w.b.service().queued_ids().unwrap(), vec!["r1".to_string()]);
    assert_eq!(w.b.git_out(&["rev-parse", "HEAD"]), tip); // no local commits
    assert!(w.b.service().drafts().get("r1").unwrap().is_some()); // still visible as unshared work
}

#[test]
fn queue_drains_on_reconnect_and_pushes_to_members() {
    let w = world();
    let base = seed(&w);
    go_offline(&w.b);
    let mut ours = base.clone();
    ours.url = "https://offline.io".into();
    w.b.service().save_or_queue(Change::Update { base, ours }).unwrap();
    w.b.service().save_or_queue(Change::Create(req("r2", "Logout", ""))).unwrap();

    // Still offline: drain keeps everything.
    let d = w.b.service().drain_queue().unwrap();
    assert!(d.offline);
    assert_eq!(w.b.service().queued_ids().unwrap().len(), 2);

    go_online(&w, &w.b);
    let d = w.b.service().drain_queue().unwrap();
    assert!(!d.offline);
    assert_eq!(d.saved, vec!["r1".to_string(), "r2".to_string()]);
    assert!(w.b.service().queued_ids().unwrap().is_empty());
    assert!(w.b.service().drafts().load().unwrap().is_empty());

    let seen = w.a.service().sync().unwrap().data.requests;
    assert_eq!(seen.len(), 2);
    assert_eq!(seen.iter().find(|r| r.id == "r1").unwrap().url, "https://offline.io");
}

#[test]
fn repeated_offline_saves_of_one_request_do_not_conflict_with_themselves() {
    let w = world();
    let base = seed(&w);
    go_offline(&w.b);
    let mut v1 = base.clone();
    v1.url = "https://one.io".into();
    let mut v2 = v1.clone();
    v2.url = "https://two.io".into();
    w.b.service().save_or_queue(Change::Update { base: base.clone(), ours: v1 }).unwrap();
    w.b.service().save_or_queue(Change::Update { base, ours: v2 }).unwrap();
    assert_eq!(w.b.service().queued_ids().unwrap().len(), 1);

    go_online(&w, &w.b);
    let d = w.b.service().drain_queue().unwrap();
    assert_eq!(d.saved, vec!["r1".to_string()]);
    assert_eq!(w.a.service().sync().unwrap().data.requests[0].url, "https://two.io");
}

#[test]
fn conflicts_found_while_draining_go_to_needs_attention_not_a_popup() {
    let w = world();
    let base = seed(&w);
    go_offline(&w.b);
    let mut ours = base.clone();
    ours.url = "https://b.io".into();
    let change = Change::Update { base: base.clone(), ours };
    w.b.service().save_or_queue(change.clone()).unwrap();
    // Meanwhile A edits the same Field.
    let mut a2 = base.clone();
    a2.url = "https://a.io".into();
    w.a.service().save(Change::Update { base, ours: a2 }).unwrap();

    go_online(&w, &w.b);
    let d = w.b.service().drain_queue().unwrap();
    assert!(d.saved.is_empty());
    assert_eq!(d.needs_attention.len(), 1);
    assert_eq!(d.needs_attention[0].request_id, "r1");
    assert_eq!(d.needs_attention[0].fields, vec!["url".to_string()]);
    assert!(w.b.service().queued_ids().unwrap().is_empty());
    assert_eq!(w.b.service().needs_attention().unwrap().len(), 1);
    assert!(w.b.service().drafts().get("r1").unwrap().is_some()); // my work is not lost

    // Resolving (Overwrite) removes it from Needs Attention.
    w.b.service().overwrite(change).unwrap();
    assert!(w.b.service().needs_attention().unwrap().is_empty());
    assert_eq!(w.a.service().sync().unwrap().data.requests[0].url, "https://b.io");
}

#[test]
fn queued_save_keeps_its_folder_id_so_a_renamed_folder_is_followed_on_drain() {
    use zenar_service::FolderOp;
    let w = world();
    w.a.service().folder_op(FolderOp::Create { id: "f1".into(), name: "auth".into(), parent_id: None, order: 1.0 }).unwrap();
    w.b.service().sync().unwrap();

    go_offline(&w.b);
    let q = w.b.service().save_or_queue_in(Change::Create(req("r9", "Login", "auth")), Some("f1")).unwrap();
    assert!(matches!(q, SaveAttempt::Queued), "{q:?}");

    // Meanwhile A renames the Folder.
    w.a.service().folder_op(FolderOp::Rename { id: "f1".into(), name: "authn".into() }).unwrap();

    go_online(&w, &w.b);
    let d = w.b.service().drain_queue().unwrap();
    assert_eq!(d.saved, vec!["r9".to_string()]);
    let seen = w.a.service().sync().unwrap().data.requests;
    assert_eq!(seen.iter().find(|r| r.id == "r9").unwrap().folder, "authn");
}
