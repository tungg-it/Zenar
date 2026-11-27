mod common;
use common::*;

const POSTMAN: &str = include_str!("../../zenar-format/tests/fixtures/postman/basic.json");

#[test]
fn import_creates_exactly_one_commit_and_pushes() {
    let w = world();
    let before: usize = w.a.git_out(&["rev-list", "--count", "HEAD"]).trim().parse().unwrap();

    let out = w.a.service().import_postman(POSTMAN).unwrap();
    assert_eq!(out.requests, 5);
    assert!(out.commit.is_some());
    // Every body mode in the fixture (raw, urlencoded, formdata) is supported, so nothing is skipped.
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);

    let after: usize = w.a.git_out(&["rev-list", "--count", "HEAD"]).trim().parse().unwrap();
    assert_eq!(after, before + 1, "exactly one commit");
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%s"]).trim(), "Import 5 requests from Postman");

    // pushed: B sees everything after sync
    let report = w.b.service().sync().unwrap();
    assert_eq!(report.data.requests.len(), 5);
    // everything sits in one Folder named after the Postman collection
    let top = report.data.folders.iter().find(|f| f.path == "pet-store").expect("wrapper folder");
    assert_eq!(top.name, "Pet Store");
    assert!(report.data.folders.iter().any(|f| f.path == "pet-store/admin/nested"));
    assert!(report.data.requests.iter().all(|r| r.folder == "pet-store" || r.folder.starts_with("pet-store/")));
    // collection-level bearer auth went on that Folder, not on the Collection
    assert_eq!(top.auth.as_ref().map(|a| a.kind.as_str()), Some("bearer"));
    assert!(report.data.auth.is_none());
}

#[test]
fn importing_twice_gives_distinct_ids() {
    let w = world();
    w.a.service().import_postman(POSTMAN).unwrap();
    w.a.service().import_postman(POSTMAN).unwrap();
    let data = zenar_format::open_collection(&w.a.root).unwrap();
    let mut ids: Vec<_> = data.requests.iter().map(|r| r.id.clone()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 10);
    // the second import gets its own Folder, ordered after the first
    let first = data.folders.iter().find(|f| f.path == "pet-store").unwrap();
    let second = data.folders.iter().find(|f| f.path == "pet-store-2").unwrap();
    assert_eq!(second.name, "Pet Store");
    assert!(second.order > first.order);
}

#[test]
fn invalid_file_changes_nothing() {
    let w = world();
    assert!(w.a.service().import_postman("{}").is_err());
    assert_eq!(w.a.git_out(&["status", "--porcelain"]).trim(), "");
}

#[test]
fn single_request_message_is_singular() {
    let w = world();
    let one = r#"{"info":{"name":"x","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[{"name":"Ping","request":{"method":"GET","url":"https://x.io"}}]}"#;
    w.a.service().import_postman(one).unwrap();
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%s"]).trim(), "Import 1 request from Postman");
}

fn export(w: &Member) -> serde_json::Value {
    let data = zenar_format::open_collection(&w.root).unwrap();
    serde_json::from_str(&zenar_format::postman_export::export_postman(&data).json).unwrap()
}

/// Every Request object of an exported collection, depth first.
fn requests_of(v: &mut serde_json::Value) -> Vec<&mut serde_json::Value> {
    let mut out = Vec::new();
    for item in v["item"].as_array_mut().unwrap() {
        if item.get("item").is_some() {
            out.extend(requests_of(item));
        } else {
            out.push(item);
        }
    }
    out
}

#[test]
fn reimporting_an_unchanged_export_changes_nothing() {
    let w = world();
    w.a.service().import_postman(POSTMAN).unwrap();
    let before = w.a.git_out(&["rev-parse", "HEAD"]);

    let out = w.a.service().import_postman(&export(&w.a).to_string()).unwrap();
    assert_eq!((out.requests, out.updated, out.commit), (5, 0, None));
    assert_eq!(w.a.git_out(&["rev-parse", "HEAD"]), before, "no commit");
    assert_eq!(w.a.git_out(&["status", "--porcelain"]).trim(), "");
}

#[test]
fn reimporting_an_edited_export_updates_in_place_and_adds_new_requests() {
    let w = world();
    w.a.service().import_postman(POSTMAN).unwrap();
    let data = zenar_format::open_collection(&w.a.root).unwrap();

    let mut file = export(&w.a);
    let edited_id = {
        let mut reqs = requests_of(&mut file);
        reqs[0]["request"]["url"]["raw"] = serde_json::json!("https://changed.example.com/pets?limit=10&offset=");
        reqs[0]["id"].as_str().unwrap().to_string()
    };
    // A new Request inside the top Folder ("Pet Store").
    file["item"][0]["item"].as_array_mut().unwrap().push(serde_json::json!({
        "name": "Brand new", "request": { "method": "GET", "url": "https://x.io/new" }
    }));

    let out = w.a.service().import_postman(&file.to_string()).unwrap();
    assert_eq!(out.updated, 1);
    assert!(out.commit.is_some());
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%s"]).trim(), "Import 6 requests from Postman (1 updated, 1 new)");

    let after = w.b.service().sync().unwrap().data;
    // Same Folders (no wrapping Folder), one more Request, the edited one kept its id and file.
    assert_eq!(after.folders.len(), data.folders.len());
    assert_eq!(after.requests.len(), data.requests.len() + 1);
    let old = data.requests.iter().find(|r| r.id == edited_id).unwrap();
    let new = after.requests.iter().find(|r| r.id == edited_id).unwrap();
    assert_eq!(new.url, "https://changed.example.com/pets");
    assert_eq!((&new.path, &new.headers, &new.params), (&old.path, &old.headers, &old.params));
    let added = after.requests.iter().find(|r| r.name == "Brand new").unwrap();
    assert_eq!(added.folder, "pet-store");
}

#[test]
fn reimport_keeps_what_postman_cannot_hold() {
    use zenar_format::{Capture, KeyValue};
    use zenar_service::{Change, Defaults};
    let w = world();
    w.a.service().import_postman(POSTMAN).unwrap();
    let data = zenar_format::open_collection(&w.a.root).unwrap();
    // A Folder header (copied into each Request on export), a `zn` script (written as `pm`) and a
    // capture (dropped on export).
    let top = data.folders.iter().find(|f| f.path == "pet-store").unwrap();
    let header = KeyValue { id: "h1".into(), key: "X-Team".into(), value: "core".into(), enabled: true, extra: None };
    let none = Defaults { headers: vec![], auth: top.auth.clone() };
    w.a.service().save_defaults(Some(&top.id), &none, &Defaults { headers: vec![header], ..none.clone() }, false).unwrap();
    let r = data.requests[0].clone();
    let mut ours = r.clone();
    ours.scripts.post_response = "zn.environment.set(\"t\", zn.response.json().token);".into();
    ours.captures = vec![Capture { id: "c1".into(), name: "petId".into(), path: "$.id".into(), extra: None }];
    w.a.service().save(Change::Update { base: r, ours }).unwrap();
    let before = w.a.git_out(&["rev-parse", "HEAD"]);

    let out = w.a.service().import_postman(&export(&w.a).to_string()).unwrap();
    assert_eq!((out.updated, out.commit), (0, None));
    assert_eq!(w.a.git_out(&["rev-parse", "HEAD"]), before, "no commit");
}
