//! `save_batch`: several tree changes (multi-select drag / delete) as one commit and one push.
mod common;
use common::*;
use zenar_service::{Change, FolderOp, TreeChange};

fn folder(id: &str, name: &str, parent: Option<&str>) -> TreeChange {
    TreeChange::Folder { op: FolderOp::Create { id: id.into(), name: name.into(), parent_id: parent.map(Into::into), order: 1.0 } }
}

fn commits(m: &Member) -> usize {
    m.git_out(&["rev-list", "--count", "HEAD"]).trim().parse().unwrap()
}

#[test]
fn moves_reorders_and_deletes_land_in_one_pushed_commit() {
    let w = world();
    let setup = w.a.service().save_batch(&[
        folder("f1", "Users", None),
        folder("f2", "Admin", None),
        TreeChange::Request { change: Change::Create(req("r1", "List", "")), folder_id: None },
        TreeChange::Request { change: Change::Create(req("r2", "Get", "")), folder_id: None },
        TreeChange::Request { change: Change::Create(req("r3", "Old", "")), folder_id: None },
    ]);
    let setup = setup.unwrap();
    assert!(setup.commit.is_some() && setup.conflicts.is_empty(), "{setup:?}");
    let d = w.b.service().sync().unwrap().data;
    let before = commits(&w.b);
    let get = |id: &str| d.requests.iter().find(|r| r.id == id).unwrap().clone();

    let moved = |id: &str, order: f64| {
        let base = get(id);
        let ours = zenar_format::RequestItem { folder: "users".into(), order, ..base.clone() };
        TreeChange::Request { change: Change::Update { base, ours }, folder_id: Some("f1".into()) }
    };
    let out = w.b.service().save_batch(&[
        moved("r1", 1.0),
        moved("r2", 2.0),
        TreeChange::Request { change: Change::Delete { base: get("r3") }, folder_id: None },
        TreeChange::Folder { op: FolderOp::Move { id: "f2".into(), parent_id: Some("f1".into()) } },
        TreeChange::Folder { op: FolderOp::Reorder { id: "f2".into(), order: 5.0 } },
    ]);
    let out = out.unwrap();
    assert!(out.commit.is_some() && out.conflicts.is_empty(), "{out:?}");
    assert_eq!(commits(&w.b), before + 1);
    assert!(w.b.git_out(&["log", "-1", "--format=%s"]).starts_with("Update 5 items"));

    let d = w.a.service().sync().unwrap().data;
    let mut in_users: Vec<_> = d.requests.iter().filter(|r| r.folder == "users").map(|r| r.id.as_str()).collect();
    in_users.sort();
    assert_eq!(in_users, ["r1", "r2"]);
    assert!(!d.requests.iter().any(|r| r.id == "r3"));
    let f2 = d.folders.iter().find(|f| f.id == "f2").unwrap();
    assert_eq!((f2.path.as_str(), f2.order), ("users/admin", 5.0));
}

#[test]
fn a_change_the_remote_no_longer_allows_is_left_out_and_the_rest_is_saved() {
    let w = world();
    w.a.service().save_batch(&[
        folder("f1", "Gone", None),
        TreeChange::Request { change: Change::Create(req("r1", "A", "")), folder_id: None },
        TreeChange::Request { change: Change::Create(req("r2", "B", "")), folder_id: None },
    ])
    .unwrap();
    let d = w.b.service().sync().unwrap().data;
    w.a.service().folder_op(FolderOp::Delete { id: "f1".into(), known_request_ids: vec![] }).unwrap();

    let r1 = d.requests.iter().find(|r| r.id == "r1").unwrap().clone();
    let r2 = d.requests.iter().find(|r| r.id == "r2").unwrap().clone();
    let into_gone = zenar_format::RequestItem { folder: "gone".into(), ..r1.clone() };
    let out = w.b.service().save_batch(&[
        TreeChange::Request { change: Change::Update { base: r1, ours: into_gone }, folder_id: Some("f1".into()) },
        TreeChange::Request { change: Change::Delete { base: r2 }, folder_id: None },
    ]);
    let out = out.unwrap();
    assert_eq!(out.conflicts.len(), 1, "{out:?}");
    assert_eq!((out.conflicts[0].index, out.conflicts[0].fields.as_slice()), (0, ["folders/f1".to_string()].as_slice()));
    assert!(out.commit.is_some());
    let d = w.a.service().sync().unwrap().data;
    assert_eq!(d.requests.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["r1"]);
}
