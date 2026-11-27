use std::fs;
use std::path::{Path, PathBuf};

use zenar_format::postman::{import_postman, ImportError};

fn fixture(name: &str) -> String {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/postman").join(name);
    fs::read_to_string(p).unwrap()
}

fn ids() -> impl FnMut() -> String {
    let mut n = 0;
    move || {
        n += 1;
        format!("id-{n}")
    }
}

/// Render the whole import (what would be written) as one text and compare it with the stored snapshot.
/// Run with UPDATE_SNAPSHOTS=1 to rewrite snapshots after an intended change.
fn check_snapshot(fixture_name: &str) {
    let imp = import_postman(&fixture(fixture_name), &mut ids()).unwrap();
    let mut out = format!("name: {}\ncollection auth: {:?}\n", imp.name, imp.auth);
    for w in &imp.warnings {
        out.push_str(&format!("warning: {w}\n"));
    }
    for f in &imp.folders {
        out.push_str(&format!("--- folder {} (name {:?}, order {}, auth {:?})\n", f.path, f.name, f.order, f.auth));
    }
    for r in &imp.requests {
        out.push_str(&format!("--- request in {:?}\n{}", r.folder, zenar_format::canonical_request_yaml(r).unwrap()));
    }
    let snap: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/postman")
        .join(fixture_name.replace(".json", ".snap"));
    if std::env::var("UPDATE_SNAPSHOTS").is_ok() || !snap.exists() {
        fs::write(&snap, &out).unwrap();
    }
    assert_eq!(out, fs::read_to_string(&snap).unwrap());
}

#[test]
fn basic_collection_matches_snapshot() {
    check_snapshot("basic.json");
}

#[test]
fn minimal_collection_matches_snapshot() {
    check_snapshot("minimal.json");
}

#[test]
fn rejects_non_v21_and_garbage() {
    assert!(matches!(import_postman("not json", &mut ids()), Err(ImportError::Invalid(_))));
    let v20 = r#"{"info":{"name":"x","schema":"https://schema.getpostman.com/json/collection/v2.0.0/collection.json"},"item":[]}"#;
    assert!(matches!(import_postman(v20, &mut ids()), Err(ImportError::UnsupportedVersion(_))));
    // An environment file picked as a collection gets a message that says what to do instead.
    let env = r#"{"id":"e","name":"Dev","values":[{"key":"base","value":"x","enabled":true}],"_postman_variable_scope":"environment"}"#;
    let err = import_postman(env, &mut ids()).unwrap_err().to_string();
    assert!(err.contains("environment file") && err.contains("Import > Environment"), "{err}");
}

#[test]
fn written_import_reopens_with_same_requests() {
    let dir = tempfile::tempdir().unwrap();
    zenar_format::init_collection(dir.path(), "C").unwrap();
    let imp = import_postman(&fixture("basic.json"), &mut ids()).unwrap();
    let paths = zenar_format::postman::write_import(dir.path(), &imp).unwrap();
    assert_eq!(paths.len(), imp.requests.len() + imp.folders.len());
    let data = zenar_format::open_collection(dir.path()).unwrap();
    assert_eq!(data.requests.len(), 5);
    assert!(data.broken.is_empty());
    assert!(data.requests.iter().any(|r| r.path == "list-pets.yaml"));
    assert!(data.requests.iter().any(|r| r.path == "list-pets-2.yaml"));
    assert!(data.folders.iter().any(|f| f.path == "admin/nested"));
}

#[test]
fn path_variables_come_from_url_variable() {
    let json = r#"{"info":{"name":"x","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
      "item":[{"name":"Get","request":{"method":"GET","url":{"raw":"{{base}}/users/:id?a=1","variable":[{"key":"id","value":"7","description":"user"}]}}}]}"#;
    let imp = import_postman(json, &mut ids()).unwrap();
    let r = &imp.requests[0];
    assert_eq!(r.url, "{{base}}/users/:id");
    let vars: Vec<_> = r.path_variables.iter().map(|v| (v.key.as_str(), v.value.as_str(), v.enabled)).collect();
    assert_eq!(vars, vec![("id", "7", true)]);
    let yaml = zenar_format::canonical_request_yaml(r).unwrap();
    assert!(yaml.contains("description: user"), "{yaml}");
}

#[test]
fn item_events_become_scripts() {
    let json = r#"{"info":{"name":"x","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
      "event":[{"listen":"prerequest","script":{"exec":["console.log(1)"]}}],
      "item":[{"name":"Login","request":{"method":"POST","url":"{{base}}/login"},
        "event":[{"listen":"prerequest","script":{"type":"text/javascript","exec":["pm.variables.set(\"a\", 1);"]}},
                 {"listen":"test","script":{"exec":["var j = pm.response.json();","pm.environment.set(\"token\", j.token);"]}}]}]}"#;
    let imp = import_postman(json, &mut ids()).unwrap();
    let s = &imp.requests[0].scripts;
    assert_eq!(s.pre_request, "pm.variables.set(\"a\", 1);");
    assert_eq!(s.post_response, "var j = pm.response.json();\npm.environment.set(\"token\", j.token);");
    assert!(imp.warnings.iter().any(|w| w.contains("collection scripts")), "{:?}", imp.warnings);
    let yaml = zenar_format::canonical_request_yaml(&imp.requests[0]).unwrap();
    assert!(yaml.contains("scripts:") && yaml.contains("post_response:"), "{yaml}");
}

#[test]
fn scripts_always_reach_the_ui_with_both_fields() {
    let json = serde_json::to_value(zenar_format::Scripts::default()).unwrap();
    assert_eq!(json, serde_json::json!({"pre_request": "", "post_response": ""}));
}
