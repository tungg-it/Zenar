//! Collection and Folder defaults (inherited headers/auth) are shared like a Request Save:
//! committed, pushed, merged by Field, and not wiped by the next fetch.
mod common;
use common::*;
use std::os::unix::fs::PermissionsExt;
use zenar_format::{open_collection, Auth};
use zenar_service::{Defaults, FolderOp, SharedSave};

fn none() -> Defaults {
    Defaults { headers: vec![], auth: None }
}

fn bearer(t: &str) -> Auth {
    Auth { kind: "bearer".into(), token: Some(t.into()), ..Default::default() }
}

#[test]
fn collection_defaults_reach_the_other_member_and_survive_a_sync() {
    let w = world();
    let ours = Defaults { headers: vec![header("h1", "X-Team", "zenar")], auth: Some(bearer("{{token}}")) };
    assert_eq!(w.a.service().save_defaults(None, &none(), &ours, false).unwrap(), SharedSave::Saved);
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%s"]).trim(), "Update \"Collection defaults\"");

    // A's own next fetch must not wipe them (it used to: they were never committed).
    let a = w.a.service().sync().unwrap();
    assert_eq!(a.data.headers.len(), 1);
    let b = w.b.service().sync().unwrap();
    assert_eq!(b.data.headers[0].key, "X-Team");
    assert_eq!(b.data.auth, Some(bearer("{{token}}")));
}

#[test]
fn concurrent_collection_defaults_edits_merge_by_field() {
    let w = world();
    let first = Defaults { headers: vec![header("h1", "X-A", "1")], auth: None };
    w.a.service().save_defaults(None, &none(), &first, false).unwrap();
    w.b.service().sync().unwrap();

    // A edits the header, B (same base) sets auth: both survive.
    let a2 = Defaults { headers: vec![header("h1", "X-A", "2")], auth: None };
    w.a.service().save_defaults(None, &first, &a2, false).unwrap();
    let b2 = Defaults { headers: first.headers.clone(), auth: Some(bearer("b")) };
    assert_eq!(w.b.service().save_defaults(None, &first, &b2, false).unwrap(), SharedSave::Saved);
    let d = open_collection(&w.b.root).unwrap();
    assert_eq!(d.headers[0].value, "2");
    assert_eq!(d.auth, Some(bearer("b")));

    // Same header edited on both sides is a Conflict.
    let a3 = Defaults { headers: vec![header("h1", "X-A", "3")], auth: b2.auth.clone() };
    w.a.service().sync().unwrap();
    w.a.service().save_defaults(None, &a2, &a3, false).unwrap();
    let b3 = Defaults { headers: vec![header("h1", "X-A", "4")], auth: b2.auth.clone() };
    let r = w.b.service().save_defaults(None, &a2, &b3, false).unwrap();
    assert_eq!(r, SharedSave::Conflict { fields: vec!["headers/h1".into()] });
}

#[test]
fn folder_defaults_are_shared_and_a_deleted_folder_is_a_conflict() {
    let w = world();
    w.a.service().folder_op(FolderOp::Create { id: "f1".into(), name: "Admin".into(), parent_id: None, order: 1.0 }).unwrap();
    w.b.service().sync().unwrap();
    let ours = Defaults { headers: vec![header("h1", "X-F", "1")], auth: None };
    assert_eq!(w.a.service().save_defaults(Some("f1"), &none(), &ours, false).unwrap(), SharedSave::Saved);
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%s"]).trim(), "Update \"Folder defaults\" (admin/)");
    let b = w.b.service().sync().unwrap();
    assert_eq!(b.data.folders[0].headers[0].key, "X-F");

    w.a.service().folder_op(FolderOp::Delete { id: "f1".into(), known_request_ids: vec![] }).unwrap();
    let r = w.b.service().save_defaults(Some("f1"), &ours, &none(), false).unwrap();
    assert_eq!(r, SharedSave::Conflict { fields: vec!["folders/f1".into()] });
}

#[test]
fn rejected_pushes_of_shared_files_mark_the_viewer_and_expired_sign_in_is_its_own_error() {
    let w = world();
    let hook = |msg: &str| {
        let path = w.bare.join("hooks/pre-receive");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, format!("#!/bin/sh\necho \"{msg}\" >&2\nexit 1\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    };
    let ours = Defaults { headers: vec![header("h1", "X", "1")], auth: None };

    hook("remote: Invalid username or password.");
    let e = w.b.service().save_defaults(None, &none(), &ours, false).unwrap_err();
    assert!(matches!(e, zenar_service::ServiceError::AuthFailed(_)), "{e}");
    assert!(!w.b.service().is_viewer(), "expired sign-in is not read-only access");

    hook("remote: You are not allowed to push code to this project.");
    let e = w.b.service().save_defaults(None, &none(), &ours, false).unwrap_err();
    assert!(matches!(e, zenar_service::ServiceError::NoWriteAccess(_)), "{e}");
    assert!(w.b.service().is_viewer(), "Collection defaults go through the same Viewer handling");
    // clone still equals the remote tip
    assert!(open_collection(&w.b.root).unwrap().headers.is_empty());
}
