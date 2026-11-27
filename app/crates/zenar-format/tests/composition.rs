use std::fs;
use zenar_format::{open_collection, save_collection_defaults, save_folder, save_request};

mod common;
use common::write;

const CANON: &str = "\
id: r1
name: Search
order: 1.0
method: GET
url: https://example.com/search
params:
- id: p1
  key: q
  value: '{{term}}'
  enabled: true
- id: p2
  key: debug
  value: '1'
  enabled: false
headers:
- id: h1
  key: Accept
  value: application/json
  enabled: true
auth:
  type: bearer
  token: '{{token}}'
body:
  type: json
  content: |
    {\"a\": 1}
";

#[test]
fn params_and_auth_round_trip_with_no_diff() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", "formatVersion: 1.0\nname: Demo\n");
    write(dir.path(), "search.yaml", CANON);
    let c = open_collection(dir.path()).unwrap();
    assert_eq!(c.requests[0].params.len(), 2);
    assert!(!c.requests[0].params[1].enabled);
    save_request(dir.path(), &c.requests[0]).unwrap();
    assert_eq!(fs::read_to_string(dir.path().join("search.yaml")).unwrap(), CANON);
}

#[test]
fn collection_and_folder_defaults_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "collection.yaml",
        "formatVersion: 1.0\nname: Demo\nheaders:\n- id: h1\n  key: X-Team\n  value: zenar\n  enabled: true\nauth:\n  type: basic\n  username: u\n  password: p\nx-future: 1\n",
    );
    write(
        dir.path(),
        "users/folder.yaml",
        "name: Users\norder: 0.0\nauth:\n  type: apikey\n  key: X-Key\n  value: abc\n  in: query\n",
    );
    let c = open_collection(dir.path()).unwrap();
    assert_eq!(c.headers[0].key, "X-Team");
    assert_eq!(c.auth.as_ref().unwrap().kind, "basic");
    let f = &c.folders[0];
    assert_eq!(f.auth.as_ref().unwrap().location.as_deref(), Some("query"));

    let before_m = fs::read_to_string(dir.path().join("collection.yaml")).unwrap();
    let before_f = fs::read_to_string(dir.path().join("users/folder.yaml")).unwrap();
    save_collection_defaults(dir.path(), &c.headers, c.auth.as_ref()).unwrap();
    save_folder(dir.path(), f).unwrap();
    assert_eq!(fs::read_to_string(dir.path().join("collection.yaml")).unwrap(), before_m);
    assert_eq!(fs::read_to_string(dir.path().join("users/folder.yaml")).unwrap(), before_f);
}

const WITH_CAPTURES: &str = "\
id: r2
name: Login
order: 1.0
method: POST
url: https://example.com/login
body:
  type: json
  content: |
    {}
captures:
- id: c1
  name: token
  path: $.data.token
  note: capture-unknown
";

#[test]
fn captures_round_trip_with_no_diff() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", "formatVersion: 1.0\nname: Demo\n");
    write(dir.path(), "login.yaml", WITH_CAPTURES);
    let c = open_collection(dir.path()).unwrap();
    let cap = &c.requests[0].captures[0];
    assert_eq!((cap.name.as_str(), cap.path.as_str()), ("token", "$.data.token"));
    save_request(dir.path(), &c.requests[0]).unwrap();
    assert_eq!(fs::read_to_string(dir.path().join("login.yaml")).unwrap(), WITH_CAPTURES);
}
