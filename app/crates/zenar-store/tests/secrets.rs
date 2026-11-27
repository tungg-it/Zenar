//! Secrets (ticket #11): values live only in the local Secret store (faked here), never in repo files.
use std::collections::HashMap;

use wiremock::matchers::{header, method};
use wiremock::{Mock, MockServer, ResponseTemplate};
use zenar_format::{CollectionData, EnvVar, EnvironmentItem, KeyValue, RequestItem};
use zenar_http::{run, CookieJar, RunOptions};
use zenar_store::secrets::{
    delete_collection_secrets, environment_vars, missing_secrets, secret_values, set_secret, FileSecrets, MemorySecrets,
    SecretStore,
};

fn var(id: &str, key: &str, value: &str, secret: bool) -> EnvVar {
    EnvVar { id: id.into(), key: key.into(), value: value.into(), secret, extra: None }
}

fn env(id: &str, vars: Vec<EnvVar>) -> EnvironmentItem {
    EnvironmentItem { id: id.into(), name: id.into(), order: 1.0, variables: vars, path: String::new(), extra: None }
}

fn collection(envs: Vec<EnvironmentItem>) -> CollectionData {
    CollectionData {
        name: "c".into(), read_only: false, requests: vec![], broken: vec![], folders: vec![],
        environments: envs, headers: vec![], auth: None,
    }
}

fn request(url: &str, header_value: &str) -> RequestItem {
    RequestItem {
        id: "r".into(), name: "r".into(), order: 1.0, method: "GET".into(), url: url.into(), folder: String::new(),
        params: vec![],
        headers: vec![KeyValue { id: "h".into(), key: "X-Token".into(), value: header_value.into(), enabled: true, extra: None }],
        auth: None, body: None, body_type: None, body_extra: None, path_variables: vec![], captures: vec![], scripts: Default::default(), path: String::new(), extra: None,
    }
}

#[tokio::test]
async fn runner_sends_secret_from_the_store() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(header("X-Token", "s3cret")).respond_with(ResponseTemplate::new(200)).expect(1).mount(&server).await;

    let e = env("dev", vec![var("v1", "base", &server.uri(), false), var("v2", "token", "", true)]);
    let store = MemorySecrets::default();
    set_secret(&store, "col", "dev", "v2", "s3cret").unwrap();

    let vars = environment_vars(&store, "col", &e);
    let out = run(
        &collection(vec![e]), &request("{{base}}/x", "{{token}}"), &vars, &HashMap::new(), &RunOptions::default(),
        &mut CookieJar::default(),
    )
    .await
    .unwrap();
    assert_eq!(out.response.status, 200);
}

#[test]
fn unfilled_secret_is_not_a_variable_so_runner_errors() {
    let e = env("dev", vec![var("v2", "token", "", true)]);
    let vars = environment_vars(&MemorySecrets::default(), "col", &e);
    assert!(!vars.contains_key("token"));
}

#[test]
fn secret_value_in_file_is_ignored_store_wins() {
    let e = env("dev", vec![var("v2", "token", "from-file", true)]);
    let k = MemorySecrets::default();
    set_secret(&k, "col", "dev", "v2", "from-store").unwrap();
    assert_eq!(environment_vars(&k, "col", &e)["token"], "from-store");
}

#[test]
fn missing_secrets_lists_only_unfilled_ones_per_environment() {
    let c = collection(vec![
        env("dev", vec![var("a", "token", "", true), var("b", "base", "http://x", false)]),
        env("prod", vec![var("c", "token", "", true), var("d", "key", "", true)]),
    ]);
    let k = MemorySecrets::default();
    set_secret(&k, "col", "prod", "c", "x").unwrap();
    let m = missing_secrets(&k, "col", &c);
    let got: Vec<_> = m.iter().map(|m| (m.environment_id.as_str(), m.key.as_str())).collect();
    assert_eq!(got, vec![("dev", "token"), ("prod", "key")]);
}

#[test]
fn empty_value_clears_the_secret() {
    let c = collection(vec![env("dev", vec![var("a", "token", "", true)])]);
    let k = MemorySecrets::default();
    set_secret(&k, "col", "dev", "a", "x").unwrap();
    set_secret(&k, "col", "dev", "a", "").unwrap();
    assert_eq!(missing_secrets(&k, "col", &c).len(), 1);
}

#[test]
fn deleting_a_collection_removes_only_its_secrets() {
    let c = collection(vec![env("dev", vec![var("a", "token", "", true)])]);
    let k = MemorySecrets::default();
    set_secret(&k, "col1", "dev", "a", "x").unwrap();
    set_secret(&k, "col2", "dev", "a", "y").unwrap();
    delete_collection_secrets(&k, "col1", &c).unwrap();
    assert_eq!(missing_secrets(&k, "col1", &c).len(), 1);
    assert!(missing_secrets(&k, "col2", &c).is_empty());
    let _: &dyn SecretStore = &k;
}

#[test]
fn file_secrets_persist_on_disk_and_show_per_environment() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("secrets.json");
    let e = env("dev", vec![var("a", "token", "", true), var("b", "url", "http://x", false), var("c", "other", "", true)]);
    set_secret(&FileSecrets::new(&path), "col", "dev", "a", "s3cret").unwrap();
    // A fresh handle reads what the last one wrote.
    let store = FileSecrets::new(&path);
    assert_eq!(secret_values(&store, "col", &e).unwrap(), HashMap::from([("a".to_string(), "s3cret".to_string())]));
    set_secret(&store, "col", "dev", "a", "").unwrap();
    assert!(secret_values(&store, "col", &e).unwrap().is_empty());
    store.delete("col/dev/missing").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
}
