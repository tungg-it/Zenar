use std::fs;
use zenar_format::open_collection;

const GET_USER: &str = "\
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
  - id: h2
    key: X-Off
    value: nope
    enabled: false
body:
  type: raw
  content: |
    hello
unknownField: kept
";

fn write(root: &std::path::Path, rel: &str, content: &str) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, content).unwrap();
}

#[test]
fn opens_collection_and_lists_requests_in_folders() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", "formatVersion: 1.0\nname: Demo\n");
    write(dir.path(), "users/get-user-by-id.yaml", GET_USER);
    write(dir.path(), "ping.yaml", "id: req-2\nname: Ping\norder: 2.0\nmethod: POST\nurl: http://x/ping\n");

    let c = open_collection(dir.path()).unwrap();

    assert_eq!(c.name, "Demo");
    assert_eq!(c.requests.len(), 2);
    let r = c.requests.iter().find(|r| r.id == "req-1").unwrap();
    assert_eq!(r.name, "Get user by id");
    assert_eq!(r.method, "GET");
    assert_eq!(r.url, "https://example.com/users/1");
    assert_eq!(r.folder, "users");
    assert_eq!(r.headers.len(), 2);
    assert_eq!(r.headers[0].key, "Accept");
    assert!(!r.headers[1].enabled);
    assert_eq!(r.body.as_deref(), Some("hello\n"));
    let p = c.requests.iter().find(|r| r.id == "req-2").unwrap();
    assert_eq!(p.folder, "");
    assert_eq!(p.body, None);
}

#[test]
fn requests_sorted_by_order_then_name() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", "formatVersion: 1.0\nname: Demo\n");
    write(dir.path(), "b.yaml", "id: b\nname: B\norder: 1.0\nmethod: GET\nurl: u\n");
    write(dir.path(), "a.yaml", "id: a\nname: A\norder: 1.0\nmethod: GET\nurl: u\n");
    write(dir.path(), "z.yaml", "id: z\nname: Z\norder: 0.5\nmethod: GET\nurl: u\n");
    let ids: Vec<_> = open_collection(dir.path()).unwrap().requests.into_iter().map(|r| r.id).collect();
    assert_eq!(ids, ["z", "a", "b"]);
}

#[test]
fn broken_request_file_is_isolated_not_fatal() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", "formatVersion: 1.0\nname: Demo\n");
    write(dir.path(), "good.yaml", "id: g\nname: G\norder: 1.0\nmethod: GET\nurl: u\n");
    write(dir.path(), "bad.yaml", "id: [unterminated\n");
    let c = open_collection(dir.path()).unwrap();
    assert_eq!(c.requests.len(), 1);
    assert_eq!(c.broken.len(), 1);
    assert_eq!(c.broken[0].path, "bad.yaml");
}

#[test]
fn higher_major_format_version_is_read_only() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "collection.yaml", "formatVersion: 2.0\nname: Demo\n");
    assert!(open_collection(dir.path()).unwrap().read_only);
    write(dir.path(), "collection.yaml", "formatVersion: 1.3\nname: Demo\n");
    assert!(!open_collection(dir.path()).unwrap().read_only);
}

#[test]
fn directory_without_manifest_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    assert!(open_collection(dir.path()).is_err());
}
