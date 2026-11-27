//! Permission states (ADR 0007): protected branch and no write access show up only when the
//! push is rejected by the host. Two real clones, real bare repo, real pre-receive hooks.
mod common;
use common::*;
use std::os::unix::fs::PermissionsExt;
use zenar_format::RequestItem;
use zenar_service::{Change, DraftReason, SaveAttempt, SaveOutcome};

fn hook(w: &World, message: &str) {
    let path = w.bare.join("hooks/pre-receive");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, format!("#!/bin/sh\necho \"{message}\" >&2\nexit 1\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn remote_tip(w: &World) -> String {
    let o = std::process::Command::new("git").args(["rev-parse", "HEAD"]).current_dir(&w.bare).output().unwrap();
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

/// A and B hold "Login"; B edits the URL.
fn edit_for_b(w: &World) -> Change {
    let SaveOutcome::Saved { request: Some(a), .. } = w.a.service().save(Change::Create(req("r1", "Login", ""))).unwrap() else { panic!() };
    let base: RequestItem = w.b.service().sync().unwrap().data.requests.remove(0);
    let mut ours = a.clone();
    ours.url = "https://b.io".into();
    Change::Update { base, ours }
}

#[test]
fn protected_branch_rejection_keeps_a_draft_and_says_so() {
    let w = world();
    let change = edit_for_b(&w);
    hook(&w, "GitLab: You are not allowed to push code to protected branches on this project.");
    let tip = remote_tip(&w);

    let attempt = w.b.service().save_or_queue(change).unwrap();
    let SaveAttempt::Draft(DraftReason::ProtectedBranch { message }) = attempt else { panic!("{attempt:?}") };
    assert!(message.contains("protected"), "{message}");
    assert_eq!(w.b.service().drafts().get("r1").unwrap().unwrap().draft.url, "https://b.io");
    // Not a Viewer: only the branch is protected. Invariant: clone == remote tip.
    assert!(!w.b.service().is_viewer());
    assert_eq!(w.b.git_out(&["rev-parse", "HEAD"]).trim(), tip);
    assert!(w.b.service().queued_ids().unwrap().is_empty());
}

#[test]
fn no_write_access_marks_viewer_on_first_rejection_and_keeps_drafts() {
    let w = world();
    let change = edit_for_b(&w);
    hook(&w, "remote: You are not allowed to push code to this project.");
    let tip = remote_tip(&w);

    let first = w.b.service().save_or_queue(change.clone()).unwrap();
    assert!(matches!(first, SaveAttempt::Draft(DraftReason::NoWriteAccess { first_rejection: true, .. })), "{first:?}");
    assert!(w.b.service().is_viewer());
    assert!(w.b.service().drafts().get("r1").unwrap().is_some());
    assert_eq!(w.b.git_out(&["rev-parse", "HEAD"]).trim(), tip);

    // Second rejection: still a Draft, but the user is not told "for the first time" again.
    let second = w.b.service().save_or_queue(change).unwrap();
    assert!(matches!(second, SaveAttempt::Draft(DraftReason::NoWriteAccess { first_rejection: false, .. })), "{second:?}");

    // A Viewer can still open the Collection and read every Request (to run them).
    let report = w.b.service().sync().unwrap();
    assert_eq!(report.data.requests[0].name, "Login");
    assert_eq!(w.b.service().drafts().load().unwrap().len(), 1);
}

#[test]
fn regained_write_access_clears_viewer_and_saves() {
    let w = world();
    let change = edit_for_b(&w);
    hook(&w, "remote: You are not allowed to push code to this project.");
    w.b.service().save_or_queue(change.clone()).unwrap();
    assert!(w.b.service().is_viewer());

    std::fs::remove_file(w.bare.join("hooks/pre-receive")).unwrap();
    let ok = w.b.service().save_or_queue(change).unwrap();
    assert!(matches!(ok, SaveAttempt::Saved(SaveOutcome::Saved { commit: Some(_), .. })), "{ok:?}");
    assert!(!w.b.service().is_viewer());
    assert!(w.b.service().drafts().get("r1").unwrap().is_none());
}

#[test]
fn rejected_credentials_keep_a_draft_with_a_sign_in_message_and_do_not_make_a_viewer() {
    let w = world();
    let change = edit_for_b(&w);
    hook(&w, "fatal: Authentication failed for 'https://host/r.git'");
    let attempt = w.b.service().save_or_queue(change).unwrap();
    let SaveAttempt::Draft(DraftReason::AuthFailed { message }) = attempt else { panic!("{attempt:?}") };
    assert!(message.contains("Sign in again"), "{message}");
    assert!(!w.b.service().is_viewer());
    assert!(w.b.service().drafts().get("r1").unwrap().is_some());
}
