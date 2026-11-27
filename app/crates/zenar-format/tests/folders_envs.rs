use std::fs;
use zenar_format::{init_collection, open_collection, order_between, save_environment, save_folder};

mod common;
use common::write;

const FOLDER: &str = "\
name: Users API
order: 2.5
x-icon: person
";

const ENV: &str = "\
id: env-dev
name: dev
order: 1.0
variables:
- id: v1
  key: baseUrl
  value: http://localhost:3000
  secret: false
- id: v2
  key: token
  secret: true
x-future: yes
";

fn collection() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", "formatVersion: 1.0\nname: Demo\n");
    dir
}

#[test]
fn folder_yaml_is_metadata_not_a_request_and_round_trips() {
    let dir = collection();
    write(dir.path(), "users/folder.yaml", FOLDER);
    write(dir.path(), "users/a.yaml", "id: a\nname: A\norder: 1.0\nmethod: GET\nurl: u\n");
    write(dir.path(), "users/inner/b.yaml", "id: b\nname: B\norder: 1.0\nmethod: GET\nurl: u\n");
    let c = open_collection(dir.path()).unwrap();
    assert!(c.broken.is_empty());
    assert_eq!(c.requests.len(), 2);
    let f = c.folders.iter().find(|f| f.path == "users").unwrap();
    assert_eq!((f.name.as_str(), f.order), ("Users API", 2.5));
    // nested folder without folder.yaml: named by directory
    let inner = c.folders.iter().find(|f| f.path == "users/inner").unwrap();
    assert_eq!(inner.name, "inner");

    save_folder(dir.path(), f).unwrap();
    assert_eq!(fs::read_to_string(dir.path().join("users/folder.yaml")).unwrap(), FOLDER);
}

#[test]
fn environments_load_round_trip_and_never_write_secret_values() {
    let dir = collection();
    write(dir.path(), "environments/dev.yaml", ENV);
    let c = open_collection(dir.path()).unwrap();
    assert!(c.requests.is_empty() && c.broken.is_empty());
    assert_eq!(c.environments.len(), 1);
    let e = &c.environments[0];
    assert_eq!(e.name, "dev");
    assert!(e.variables[1].secret);

    let mut e2 = e.clone();
    e2.variables[1].value = "hunter2".into();
    save_environment(dir.path(), &e2).unwrap();
    let text = fs::read_to_string(dir.path().join("environments/dev.yaml")).unwrap();
    assert_eq!(text, ENV);
    assert!(!text.contains("hunter2"));
}

#[test]
fn broken_environment_is_isolated() {
    let dir = collection();
    write(dir.path(), "environments/bad.yaml", "id: [oops\n");
    write(dir.path(), "a.yaml", "id: a\nname: A\norder: 1.0\nmethod: GET\nurl: u\n");
    let c = open_collection(dir.path()).unwrap();
    assert_eq!(c.requests.len(), 1);
    assert_eq!(c.broken[0].path, "environments/bad.yaml");
}

#[test]
fn broken_folder_yaml_does_not_break_requests() {
    let dir = collection();
    write(dir.path(), "x/folder.yaml", "name: [oops\n");
    write(dir.path(), "x/a.yaml", "id: a\nname: A\norder: 1.0\nmethod: GET\nurl: u\n");
    let c = open_collection(dir.path()).unwrap();
    assert_eq!(c.requests.len(), 1);
    assert_eq!(c.broken[0].path, "x/folder.yaml");
}

#[test]
fn init_collection_writes_manifest_that_opens() {
    let dir = tempfile::tempdir().unwrap();
    init_collection(dir.path(), "Demo").unwrap();
    assert_eq!(fs::read_to_string(dir.path().join("collection.yaml")).unwrap(), "formatVersion: 1.0\nname: Demo\n");
    assert_eq!(open_collection(dir.path()).unwrap().name, "Demo");
}

#[test]
fn sparse_order_between_neighbours() {
    assert_eq!(order_between(None, None), 1.0);
    assert_eq!(order_between(Some(1.0), None), 2.0);
    assert_eq!(order_between(None, Some(1.0)), 0.0);
    assert_eq!(order_between(Some(1.0), Some(2.0)), 1.5);
    let mid = order_between(Some(1.0), Some(1.5));
    assert!(mid > 1.0 && mid < 1.5);
}

#[test]
fn folder_has_stable_id_from_folder_yaml_with_path_fallback_for_legacy() {
    let dir = collection();
    write(dir.path(), "users/folder.yaml", "id: f-users\nname: Users\norder: 1.0\n");
    write(dir.path(), "legacy/a.yaml", "id: a\nname: A\norder: 1.0\nmethod: GET\nurl: u\n");
    let c = open_collection(dir.path()).unwrap();
    assert_eq!(c.folders.iter().find(|f| f.path == "users").unwrap().id, "f-users");
    let l = c.folders.iter().find(|f| f.path == "legacy").unwrap();
    assert_eq!(l.id, "path:legacy");

    let f = c.folders.iter().find(|f| f.path == "users").unwrap();
    save_folder(dir.path(), f).unwrap();
    let text = fs::read_to_string(dir.path().join("users/folder.yaml")).unwrap();
    assert!(text.starts_with("id: f-users\nname: Users\n"), "{text}");
    save_folder(dir.path(), l).unwrap();
    assert!(!fs::read_to_string(dir.path().join("legacy/folder.yaml")).unwrap().contains("id:"));
}

#[test]
fn order_ties_break_by_name_within_a_folder() {
    let dir = collection();
    write(dir.path(), "f/b.yaml", "id: b\nname: Beta\norder: 1.0\nmethod: GET\nurl: u\n");
    write(dir.path(), "f/a.yaml", "id: a\nname: Alpha\norder: 1.0\nmethod: GET\nurl: u\n");
    write(dir.path(), "g/c.yaml", "id: c\nname: Aardvark\norder: 1.0\nmethod: GET\nurl: u\n");
    let c = open_collection(dir.path()).unwrap();
    let in_f: Vec<_> = c.requests.iter().filter(|r| r.folder == "f").map(|r| r.name.as_str()).collect();
    assert_eq!(in_f, ["Alpha", "Beta"]);
}
