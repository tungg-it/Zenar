use std::fs;
use std::path::Path;
use zenar_format::{open_collection, save_request};

mod common;
use common::write;

/// Canonical sample: fixed key order, block `|` body, unknown fields at every level.
const CANON: &str = "\
id: req-1
name: Get user by id
order: 1.0
method: GET
url: https://example.com/users/1
headers:
- id: h1
  key: Accept
  value: application/json
  enabled: true
  note: header-unknown
body:
  type: raw
  content: |
    hello
    world
  lang: json
x-future: 42
x-tags:
- a
- b
";

fn setup() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", "formatVersion: 1.0\nname: Demo\n");
    write(dir.path(), "users/get-user-by-id.yaml", CANON);
    dir
}

fn read(root: &Path, rel: &str) -> String {
    fs::read_to_string(root.join(rel)).unwrap()
}

#[test]
fn open_then_save_is_byte_identical_and_keeps_unknown_fields() {
    let dir = setup();
    let c = open_collection(dir.path()).unwrap();
    let path = save_request(dir.path(), &c.requests[0]).unwrap();
    assert_eq!(path, "users/get-user-by-id.yaml");
    assert_eq!(read(dir.path(), &path), CANON);
}

#[test]
fn edits_are_written_and_unknown_fields_survive() {
    let dir = setup();
    let mut r = open_collection(dir.path()).unwrap().requests.remove(0);
    r.url = "https://example.com/v2".into();
    save_request(dir.path(), &r).unwrap();
    let text = read(dir.path(), "users/get-user-by-id.yaml");
    assert!(text.contains("url: https://example.com/v2\n"));
    assert!(text.contains("x-future: 42\n") && text.contains("note: header-unknown\n") && text.contains("lang: json\n"));
}
