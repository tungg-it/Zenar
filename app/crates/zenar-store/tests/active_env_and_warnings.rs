//! Ticket #11: active Environment is a local choice; hard-coded token warning on Save.
use std::fs;

use zenar_format::{KeyValue, RequestItem};
use zenar_store::warnings::{token_warnings, TokenWarning};
use zenar_store::LocalStore;

fn request(headers: &[(&str, &str)], body: Option<&str>) -> RequestItem {
    RequestItem {
        id: "r".into(), name: "r".into(), order: 1.0, method: "POST".into(), url: "https://x.io".into(),
        folder: String::new(), params: vec![],
        headers: headers
            .iter()
            .enumerate()
            .map(|(i, (k, v))| KeyValue { id: format!("h{i}"), key: (*k).into(), value: (*v).into(), enabled: true, extra: None })
            .collect(),
        auth: None, body: body.map(String::from), body_type: None, body_extra: None, path_variables: vec![], captures: vec![], scripts: Default::default(),
        path: String::new(), extra: None,
    }
}

#[test]
fn active_environment_is_per_collection_and_stays_in_the_local_store() {
    let dir = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let store = LocalStore::new(dir.path());
    assert_eq!(store.active_environment("/a"), None);
    store.set_active_environment("/a", Some("dev")).unwrap();
    store.set_active_environment("/b", Some("prod")).unwrap();
    let reopened = LocalStore::new(dir.path());
    assert_eq!(reopened.active_environment("/a").as_deref(), Some("dev"));
    assert_eq!(reopened.active_environment("/b").as_deref(), Some("prod"));
    reopened.set_active_environment("/a", None).unwrap();
    assert_eq!(reopened.active_environment("/a"), None);
    assert_eq!(fs::read_dir(repo.path()).unwrap().count(), 0);
}

#[test]
fn literal_authorization_header_warns() {
    let w = token_warnings(&request(&[("Authorization", "Bearer abcdef123456789")], None));
    assert_eq!(w, vec![TokenWarning { location: "header".into(), name: "Authorization".into(), disabled: false }]);
}

#[test]
fn variable_reference_does_not_warn() {
    assert!(token_warnings(&request(&[("Authorization", "Bearer {{token}}"), ("X-Api-Key", "{{key}}")], None)).is_empty());
}

#[test]
fn ordinary_headers_do_not_warn() {
    assert!(token_warnings(&request(&[("Accept", "application/json"), ("Authorization", "")], Some("{\"a\": 1}"))).is_empty());
}

#[test]
fn jwt_in_any_header_or_in_body_warns() {
    let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl";
    let w = token_warnings(&request(&[("X-Custom", jwt)], Some(&format!("{{\"t\": \"{jwt}\"}}"))));
    assert_eq!(
        w,
        vec![
            TokenWarning { location: "header".into(), name: "X-Custom".into(), disabled: false },
            TokenWarning { location: "body".into(), name: String::new(), disabled: false },
        ]
    );
}

#[test]
fn well_known_token_prefixes_in_body_warn() {
    for t in ["ghp_0123456789abcdefghijABCDEFGHIJ012345", "glpat-abcdefghij0123456789", "sk-abcdefghijklmnopqrstuv", "AKIAIOSFODNN7EXAMPLE"] {
        assert_eq!(token_warnings(&request(&[], Some(&format!("key={t}")))).len(), 1, "{t}");
    }
}

#[test]
fn disabled_headers_are_ignored() {
    let mut r = request(&[("Authorization", "Bearer abcdef123456789")], None);
    r.headers[0].enabled = false;
    assert!(token_warnings(&r).is_empty());
}

#[test]
fn collection_warnings_name_where_each_literal_credential_is() {
    use zenar_format::{Auth, CollectionData, FolderItem};
    use zenar_store::warnings::collection_token_warnings;
    let bearer = |t: &str| Some(Auth { kind: "bearer".into(), token: Some(t.into()), username: None, password: None, key: None, value: None, location: None });
    let mut literal = request(&[("Authorization", "Bearer abcdef123456789")], None);
    literal.folder = "paying".into();
    literal.name = "/refund".into();
    let mut by_auth = request(&[], None);
    by_auth.id = "r2".into();
    by_auth.auth = bearer("abcdef123456789");
    let mut off = request(&[("Authorization", "Bearer abcdef123456789")], None);
    off.id = "r4".into();
    off.name = "off".into();
    off.headers[0].enabled = false;
    let mut clean = request(&[("Authorization", "Bearer {{token}}")], None);
    clean.id = "r3".into();
    clean.auth = bearer("{{token}}");
    let data = CollectionData {
        name: "C".into(), read_only: false, broken: vec![], environments: vec![], headers: vec![], auth: None,
        folders: vec![FolderItem { id: "f1".into(), path: "paying".into(), name: "PAYING".into(), order: 1.0, headers: vec![], auth: bearer("abcdef123456789"), extra: None }],
        requests: vec![literal, by_auth, off, clean],
    };
    let w: Vec<(String, String, Vec<String>)> = collection_token_warnings(&data)
        .into_iter()
        .map(|p| (p.kind, p.place, p.warnings.into_iter().map(|w| format!("{} {}{}", w.location, w.name, if w.disabled { " off" } else { "" })).collect()))
        .collect();
    assert_eq!(
        w,
        [
            ("folder".into(), "PAYING".into(), vec!["auth bearer".to_string()]),
            ("request".into(), "PAYING / /refund".into(), vec!["header Authorization".to_string()]),
            ("request".into(), "r".into(), vec!["auth bearer".to_string()]),
            // Not sent, still exported.
            ("request".into(), "off".into(), vec!["header Authorization off".to_string()]),
        ]
    );
}
