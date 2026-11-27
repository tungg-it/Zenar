mod common;
use common::*;
use zenar_service::{Change, SaveOutcome};

fn saved_on_a_synced_to_b(w: &World) -> (zenar_format::RequestItem, zenar_format::RequestItem) {
    let SaveOutcome::Saved { request: Some(a), .. } = w.a.service().save(Change::Create(req("r1", "Login", ""))).unwrap() else { panic!() };
    let b = w.b.service().sync().unwrap().data.requests.remove(0);
    (a, b)
}

#[test]
fn draft_survives_restart_and_is_not_overwritten_by_incoming_change() {
    let w = world();
    let (a, b) = saved_on_a_synced_to_b(&w);

    // B edits and keeps a Draft.
    let mut b_draft = b.clone();
    b_draft.url = "https://b-draft.io".into();
    w.b.service().drafts().put("r1", Some(b.clone()), b_draft.clone()).unwrap();

    // A saves a change to the same Request.
    let mut a2 = a.clone();
    a2.url = "https://a.io".into();
    w.a.service().save(Change::Update { base: a, ours: a2 }).unwrap();

    // B syncs: Draft kept, alert names A, the file on disk is updated but not the Draft.
    let report = w.b.service().sync().unwrap();
    assert!(report.applied.is_empty());
    assert_eq!(report.draft_alerts.len(), 1);
    assert_eq!(report.draft_alerts[0].request_id, "r1");
    assert_eq!(report.draft_alerts[0].author.as_deref(), Some("Member A"));

    // "Restart": a brand new service over the same store dir.
    let again = w.b.service().drafts().get("r1").unwrap().unwrap();
    assert_eq!(again.draft.url, "https://b-draft.io");
    assert!(again.remote_changed);
    assert_eq!(again.base.unwrap().url, "https://x.io");
}

#[test]
fn untouched_requests_apply_silently_while_other_drafts_stay() {
    let w = world();
    let (a, b) = saved_on_a_synced_to_b(&w);
    w.a.service().save(Change::Create(req("r2", "Other", ""))).unwrap();
    let mut b_draft = b.clone();
    b_draft.url = "https://b-draft.io".into();
    w.b.service().drafts().put("r1", Some(b), b_draft).unwrap();
    let _ = a;
    let report = w.b.service().sync().unwrap();
    assert_eq!(report.applied, vec!["r2".to_string()]);
    assert!(report.draft_alerts.is_empty());
    assert!(!w.b.service().drafts().get("r1").unwrap().unwrap().remote_changed);
}

#[test]
fn successful_save_clears_the_draft_and_conflict_keeps_it() {
    let w = world();
    let (a, b) = saved_on_a_synced_to_b(&w);
    let mut a2 = a.clone();
    a2.url = "https://a.io".into();
    w.a.service().save(Change::Update { base: a, ours: a2 }).unwrap();

    let mut b2 = b.clone();
    b2.url = "https://b.io".into();
    w.b.service().drafts().put("r1", Some(b.clone()), b2.clone()).unwrap();
    let out = w.b.service().save(Change::Update { base: b.clone(), ours: b2 }).unwrap();
    assert!(matches!(out, SaveOutcome::Conflict { .. }));
    assert!(w.b.service().drafts().get("r1").unwrap().is_some());

    let mut b3 = b.clone();
    b3.method = "POST".into();
    w.b.service().drafts().put("r1", Some(b.clone()), b3.clone()).unwrap();
    w.b.service().save(Change::Update { base: b, ours: b3 }).unwrap();
    assert!(w.b.service().drafts().get("r1").unwrap().is_none());
}

#[test]
fn drafts_live_outside_the_repo() {
    let w = world();
    let (_, b) = saved_on_a_synced_to_b(&w);
    w.b.service().drafts().put("r1", Some(b.clone()), b).unwrap();
    assert!(!w.b.store.starts_with(&w.b.root));
    assert!(w.b.store.join("drafts.yaml").is_file());
    assert_eq!(w.b.git_out(&["status", "--porcelain"]), "");
}
