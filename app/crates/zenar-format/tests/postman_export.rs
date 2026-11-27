//! Export a Collection to Postman v2.1: what comes back through our own import is what went out.
use std::fs;
use std::path::Path;

use zenar_format::postman::{import_postman, PostmanImport};
use zenar_format::postman_export::export_postman;
use zenar_format::{Capture, CollectionData, FolderItem, KeyValue, RequestItem, Scripts};

fn fixture(name: &str) -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/postman").join(name)).unwrap()
}

fn ids() -> impl FnMut() -> String {
    let mut n = 0;
    move || {
        n += 1;
        format!("id-{n}")
    }
}

fn collection(imp: PostmanImport) -> CollectionData {
    CollectionData {
        name: imp.name, read_only: false, requests: imp.requests, broken: vec![], folders: imp.folders,
        environments: vec![], headers: vec![], auth: imp.auth,
    }
}

fn header(key: &str, value: &str) -> KeyValue {
    KeyValue { id: format!("h-{key}-{value}"), key: key.into(), value: value.into(), enabled: true, extra: None }
}

fn request(id: &str, folder: &str) -> RequestItem {
    RequestItem {
        id: id.into(), name: id.into(), order: 1.0, method: "GET".into(), url: "https://x".into(), folder: folder.into(),
        params: vec![], path_variables: vec![], headers: vec![], auth: None, body: None, body_type: None, body_extra: None,
        captures: vec![], scripts: Scripts::default(), path: String::new(), extra: None,
    }
}

#[test]
fn a_postman_collection_survives_import_export_import() {
    for name in ["basic.json", "minimal.json"] {
        let first = import_postman(&fixture(name), &mut ids()).unwrap();
        let out = export_postman(&collection(first.clone()));
        assert!(out.warnings.is_empty(), "{name}: {:?}", out.warnings);
        let again = import_postman(&out.json, &mut ids()).unwrap();
        assert_eq!(again.name, first.name, "{name}");
        assert_eq!(again.auth, first.auth, "{name}");
        assert_eq!(again.folders, first.folders, "{name}");
        assert_eq!(again.requests, first.requests, "{name}");
    }
}

#[test]
fn collection_and_folder_headers_are_copied_into_each_request() {
    let mut data = collection(import_postman(&fixture("minimal.json"), &mut ids()).unwrap());
    data.requests = vec![{
        let mut r = request("r", "api/v1");
        r.headers = vec![header("x-trace", "request")];
        r
    }];
    data.folders = vec![
        FolderItem { id: "f1".into(), path: "api".into(), name: "api".into(), order: 1.0, headers: vec![header("Accept", "json"), header("X-Trace", "folder")], auth: None, extra: None },
        FolderItem { id: "f2".into(), path: "api/v1".into(), name: "v1".into(), order: 1.0, headers: vec![], auth: None, extra: None },
    ];
    data.headers = vec![header("User-Agent", "zenar"), header("Accept", "*/*")];

    let again = import_postman(&export_postman(&data).json, &mut ids()).unwrap();
    let got: Vec<(String, String)> = again.requests[0].headers.iter().map(|h| (h.key.clone(), h.value.clone())).collect();
    let want = [("User-Agent", "zenar"), ("Accept", "json"), ("x-trace", "request")];
    assert_eq!(got, want.map(|(k, v)| (k.to_string(), v.to_string())));
}

#[test]
fn scripts_speak_pm_and_captures_are_reported() {
    let mut data = collection(import_postman(&fixture("minimal.json"), &mut ids()).unwrap());
    let mut r = request("Login", "");
    r.scripts.post_response = "zn.environment.set(\"t\", zn.response.json().token);\nconst myzn = 1; obj.zn.x;".into();
    r.captures = vec![Capture { id: "c".into(), name: "token".into(), path: "$.token".into(), extra: None }];
    data.requests = vec![r];

    let out = export_postman(&data);
    assert_eq!(out.warnings, vec!["\"Login\": 1 capture(s) skipped (Postman has no captures)".to_string()]);
    let again = import_postman(&out.json, &mut ids()).unwrap();
    assert_eq!(
        again.requests[0].scripts.post_response,
        "pm.environment.set(\"t\", pm.response.json().token);\nconst myzn = 1; obj.zn.x;"
    );
}

#[test]
fn graphql_binary_and_path_variables_round_trip() {
    let mut data = collection(import_postman(&fixture("minimal.json"), &mut ids()).unwrap());
    let mapping = |k: &str, v: &str| {
        let mut m = serde_yaml::Mapping::new();
        m.insert(k.into(), v.into());
        Some(m)
    };
    let mut gql = request("gql", "");
    gql.method = "POST".into();
    gql.body = Some("query { me { id } }".into());
    gql.body_type = Some("graphql".into());
    gql.body_extra = mapping("variables", "{\"a\":1}");
    let mut bin = request("bin", "");
    bin.order = 2.0;
    bin.url = "https://x/users/:id".into();
    bin.path_variables = vec![header("id", "42")];
    bin.body = Some(String::new());
    bin.body_type = Some("binary".into());
    bin.body_extra = mapping("file", "/tmp/a.png");
    data.requests = vec![gql, bin];

    let again = import_postman(&export_postman(&data).json, &mut ids()).unwrap();
    let (g, b) = (&again.requests[0], &again.requests[1]);
    assert_eq!((g.body.as_deref(), g.graphql_variables().as_deref()), (Some("query { me { id } }"), Some("{\"a\":1}")));
    assert_eq!((b.url.as_str(), b.body_file().as_deref()), ("https://x/users/:id", Some("/tmp/a.png")));
    assert_eq!((b.path_variables[0].key.as_str(), b.path_variables[0].value.as_str()), ("id", "42"));
}
