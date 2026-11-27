use std::fs;
use zenar_format::{create_request, open_collection, save_request, OpenError, RequestItem};

mod common;
use common::write;

fn new_req(id: &str, name: &str, folder: &str) -> RequestItem {
    RequestItem {
        id: id.into(),
        name: name.into(),
        order: 1.0,
        method: "GET".into(),
        url: "http://x".into(),
        folder: folder.into(),
        params: vec![],
        headers: vec![],
        auth: None,
        body: None,
        body_type: None,
        body_extra: None,
        path_variables: vec![], captures: vec![], scripts: Default::default(),
        path: String::new(),
        extra: None,
    }
}

fn collection(version: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", &format!("formatVersion: {version}\nname: Demo\n"));
    dir
}

#[test]
fn new_request_file_is_named_by_slug_in_its_folder() {
    let dir = collection("1.0");
    let p = create_request(dir.path(), &new_req("a", "Get User By Id!", "users")).unwrap();
    assert_eq!(p, "users/get-user-by-id.yaml");
    assert!(dir.path().join(&p).is_file());
}

#[test]
fn slug_collision_gets_numeric_suffix() {
    let dir = collection("1.0");
    let p1 = create_request(dir.path(), &new_req("a", "Login", "")).unwrap();
    let p2 = create_request(dir.path(), &new_req("b", "login", "")).unwrap();
    let p3 = create_request(dir.path(), &new_req("c", "LOGIN", "")).unwrap();
    assert_eq!((p1.as_str(), p2.as_str(), p3.as_str()), ("login.yaml", "login-2.yaml", "login-3.yaml"));
    assert_eq!(open_collection(dir.path()).unwrap().requests.len(), 3);
}

#[test]
fn name_without_slug_characters_falls_back() {
    let dir = collection("1.0");
    assert_eq!(create_request(dir.path(), &new_req("a", "???", "")).unwrap(), "request.yaml");
}

#[test]
fn reserved_names_do_not_clobber_manifest() {
    let dir = collection("1.0");
    let p = create_request(dir.path(), &new_req("a", "Collection", "")).unwrap();
    assert_eq!(p, "collection-2.yaml");
    let c = open_collection(dir.path()).unwrap();
    assert_eq!(c.requests.len(), 1);
}

#[test]
fn higher_major_refuses_writes() {
    let dir = collection("2.0");
    write(dir.path(), "a.yaml", "id: a\nname: A\norder: 1.0\nmethod: GET\nurl: u\n");
    let before = fs::read_to_string(dir.path().join("a.yaml")).unwrap();
    let r = open_collection(dir.path()).unwrap().requests.remove(0);
    assert!(matches!(save_request(dir.path(), &r), Err(OpenError::ReadOnly)));
    assert!(matches!(create_request(dir.path(), &new_req("n", "N", "")), Err(OpenError::ReadOnly)));
    assert_eq!(fs::read_to_string(dir.path().join("a.yaml")).unwrap(), before);
}

#[test]
fn higher_minor_stays_editable_and_version_is_not_downgraded() {
    let dir = collection("1.7");
    create_request(dir.path(), &new_req("a", "A", "")).unwrap();
    let c = open_collection(dir.path()).unwrap();
    assert!(!c.read_only);
    let mut r = c.requests[0].clone();
    r.name = "B".into();
    save_request(dir.path(), &r).unwrap();
    assert!(fs::read_to_string(dir.path().join("collection.yaml")).unwrap().contains("1.7"));
}
