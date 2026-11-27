//! Tree operations over two real clones: Folder CRUD by id, Request create/delete/restore, reorder.
mod common;
use common::*;
use zenar_service::{Change, FolderOp, SaveOutcome};

fn mkfolder(m: &Member, id: &str, name: &str, parent: Option<&str>) {
    let out = m
        .service()
        .folder_op(FolderOp::Create { id: id.into(), name: name.into(), parent_id: parent.map(Into::into), order: 1.0 })
        .unwrap();
    assert!(matches!(out, SaveOutcome::Saved { commit: Some(_), .. }), "{out:?}");
}

fn sync(m: &Member) -> zenar_format::CollectionData {
    m.service().sync().unwrap().data
}

fn is_conflict(o: &SaveOutcome, field: &str) -> bool {
    matches!(o, SaveOutcome::Conflict { conflicts, .. } if conflicts.iter().any(|c| c.field == field))
}

#[test]
fn folders_nest_and_are_shared_with_ids() {
    let w = world();
    mkfolder(&w.a, "f1", "Users API", None);
    mkfolder(&w.a, "f2", "Admin", Some("f1"));
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%s"]).trim(), "Create folder \"Admin\" (users-api/)");
    let d = sync(&w.b);
    let f2 = d.folders.iter().find(|f| f.id == "f2").unwrap();
    assert_eq!((f2.path.as_str(), f2.name.as_str()), ("users-api/admin", "Admin"));
}

#[test]
fn request_added_into_a_folder_renamed_meanwhile_lands_in_the_renamed_folder() {
    let w = world();
    mkfolder(&w.a, "f1", "Users", None);
    sync(&w.b);
    w.a.service().folder_op(FolderOp::Rename { id: "f1".into(), name: "People".into() }).unwrap();
    // B still thinks the folder is "users"
    let out = w.b.service().save_in(Change::Create(req("r1", "List", "users")), Some("f1")).unwrap();
    let SaveOutcome::Saved { request: Some(r), .. } = out else { panic!("{out:?}") };
    assert_eq!((r.folder.as_str(), r.path.as_str()), ("people", "people/list.yaml"));
    let d = sync(&w.a);
    assert_eq!(d.requests.len(), 1);
    assert_eq!(d.requests[0].folder, "people");
    assert!(!w.a.root.join("users").exists());
}

#[test]
fn rename_moves_existing_requests_and_other_side_edit_still_merges() {
    let w = world();
    mkfolder(&w.a, "f1", "Users", None);
    w.a.service().save(Change::Create(req("r1", "List", "users"))).unwrap();
    let d = sync(&w.b);
    let base = d.requests[0].clone();
    w.a.service().folder_op(FolderOp::Rename { id: "f1".into(), name: "People".into() }).unwrap();
    let mut ours = base.clone();
    ours.url = "https://new".into();
    let out = w.b.service().save(Change::Update { base, ours }).unwrap();
    let SaveOutcome::Saved { request: Some(r), .. } = out else { panic!("{out:?}") };
    assert_eq!((r.folder.as_str(), r.url.as_str()), ("people", "https://new"));
}

#[test]
fn add_or_move_into_a_folder_deleted_remotely_is_a_conflict() {
    let w = world();
    mkfolder(&w.a, "f1", "Gone", None);
    mkfolder(&w.a, "f2", "Other", None);
    w.a.service().save(Change::Create(req("r1", "Mover", "other"))).unwrap();
    let d = sync(&w.b);
    let base = d.requests[0].clone();
    w.a.service().folder_op(FolderOp::Delete { id: "f1".into(), known_request_ids: vec![] }).unwrap();

    let out = w.b.service().save_in(Change::Create(req("r2", "New", "gone")), Some("f1")).unwrap();
    assert!(is_conflict(&out, "folders/f1"), "{out:?}");
    assert!(!w.b.root.join("gone").exists());

    let mut ours = base.clone();
    ours.folder = "gone".into();
    let out = w.b.service().save_in(Change::Update { base, ours }, Some("f1")).unwrap();
    assert!(is_conflict(&out, "folders/f1"), "{out:?}");
}

#[test]
fn edit_vs_delete_can_be_restored_by_saving_again() {
    let w = world();
    w.a.service().save(Change::Create(req("r1", "Login", "auth"))).unwrap();
    let base = sync(&w.b).requests[0].clone();
    w.a.service().save(Change::Delete { base: base.clone() }).unwrap();

    let mut ours = base.clone();
    ours.url = "https://mine".into();
    let out = w.b.service().save(Change::Update { base, ours: ours.clone() }).unwrap();
    assert!(matches!(&out, SaveOutcome::Conflict { theirs: None, .. }), "{out:?}");
    assert!(is_conflict(&out, "requests/r1"));

    // "Restore": save my version as a new Request with the same id.
    let out = w.b.service().save(Change::Create(ours)).unwrap();
    assert!(matches!(out, SaveOutcome::Saved { commit: Some(_), .. }));
    let d = sync(&w.a);
    assert_eq!((d.requests.len(), d.requests[0].url.as_str()), (1, "https://mine"));
}

#[test]
fn same_name_requests_created_concurrently_both_survive() {
    let w = world();
    w.a.service().save(Change::Create(req("r1", "Login", "auth"))).unwrap();
    w.b.service().save(Change::Create(req("r2", "Login", "auth"))).unwrap();
    let d = sync(&w.a);
    let mut paths: Vec<_> = d.requests.iter().map(|r| r.path.clone()).collect();
    paths.sort();
    assert_eq!(paths, ["auth/login-2.yaml", "auth/login.yaml"]);
    assert_eq!(d.requests.len(), 2);
}

#[test]
fn move_folder_into_another_and_delete_folder() {
    let w = world();
    mkfolder(&w.a, "f1", "Users", None);
    mkfolder(&w.a, "f2", "Admin", None);
    w.a.service().save(Change::Create(req("r1", "List", "admin"))).unwrap();
    sync(&w.b);
    w.a.service().folder_op(FolderOp::Move { id: "f2".into(), parent_id: Some("f1".into()) }).unwrap();
    let d = sync(&w.b);
    assert_eq!(d.requests[0].folder, "users/admin");
    assert_eq!(d.folders.iter().find(|f| f.id == "f2").unwrap().path, "users/admin");

    // cannot move into own descendant
    assert!(w.a.service().folder_op(FolderOp::Move { id: "f1".into(), parent_id: Some("f2".into()) }).is_err());

    // B deletes the folder knowing r1; nothing else inside
    let out = w.b.service().folder_op(FolderOp::Delete { id: "f2".into(), known_request_ids: vec!["r1".into()] }).unwrap();
    assert!(matches!(out, SaveOutcome::Saved { commit: Some(_), .. }));
    let d = sync(&w.a);
    assert!(d.requests.is_empty());
    assert!(d.folders.iter().all(|f| f.id != "f2"));
}

#[test]
fn deleting_a_folder_that_gained_a_request_meanwhile_is_a_conflict() {
    let w = world();
    mkfolder(&w.a, "f1", "Users", None);
    sync(&w.b);
    w.a.service().save(Change::Create(req("r9", "Surprise", "users"))).unwrap();
    let out = w.b.service().folder_op(FolderOp::Delete { id: "f1".into(), known_request_ids: vec![] }).unwrap();
    assert!(is_conflict(&out, "requests/r9"), "{out:?}");
    assert!(w.b.root.join("users/surprise.yaml").exists());
}

#[test]
fn reorder_is_a_one_line_diff_in_one_file() {
    let w = world();
    for (id, n, o) in [("r1", "A", 1.0), ("r2", "B", 2.0), ("r3", "C", 3.0)] {
        let mut r = req(id, n, "f");
        r.order = o;
        w.a.service().save(Change::Create(r)).unwrap();
    }
    let d = sync(&w.a);
    let base = d.requests.iter().find(|r| r.id == "r3").unwrap().clone();
    let mut ours = base.clone();
    ours.order = zenar_format::order_between(Some(1.0), Some(2.0)); // C between A and B
    w.a.service().save(Change::Update { base, ours }).unwrap();
    let stat = w.a.git_out(&["show", "--numstat", "--format="]);
    assert_eq!(stat.trim(), "1\t1\tf/c.yaml");
    let d = sync(&w.b);
    let names: Vec<_> = d.requests.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, ["A", "C", "B"]);

    // folders reorder the same way
    mkfolder(&w.a, "g1", "G", None);
    w.a.service().folder_op(FolderOp::Reorder { id: "g1".into(), order: 0.5 }).unwrap();
    let stat = w.a.git_out(&["show", "--numstat", "--format="]);
    assert_eq!(stat.trim(), "1\t1\tg/folder.yaml");
}
