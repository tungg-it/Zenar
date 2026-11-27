//! Environment files passed between Members by hand (ticket #24).
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use zenar_format::env_file::{export_postman_environment, parse_environment_file, EnvFile, EnvFileError, EnvFileVar};
use zenar_format::{EnvVar, EnvironmentItem};

fn fixture(name: &str) -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/environments").join(name)).unwrap()
}

fn v(key: &str, value: &str, secret: bool, enabled: bool) -> EnvFileVar {
    EnvFileVar { key: key.into(), value: value.into(), secret, enabled }
}

#[test]
fn postman_environment_keeps_id_name_secrets_and_disabled_flags() {
    let f = parse_environment_file(&fixture("staging.postman_environment.json")).unwrap();
    assert_eq!(
        f,
        EnvFile {
            id: Some("5d1c6e2a-postman-env".into()),
            name: Some("staging".into()),
            variables: vec![
                v("baseUrl", "https://staging.example.com", false, true),
                v("token", "s3cret", true, true),
                v("retries", "3", false, true),
                v("old", "x", false, false),
                v("nothing", "", false, true),
            ],
        }
    );
}

#[test]
fn dotenv_has_no_id_or_name_and_every_variable_is_plain() {
    let f = parse_environment_file(&fixture("app.env")).unwrap();
    assert_eq!(
        f,
        EnvFile {
            id: None,
            name: None,
            variables: vec![
                v("BASE_URL", "http://localhost:3000", false, true),
                v("API_KEY", "abc\"123\n", false, true),
                v("QUOTED", "keep # this", false, true),
                v("PLAIN", "value", false, true),
                v("EMPTY", "", false, true),
            ],
        }
    );
}

#[test]
fn a_postman_collection_is_refused_with_a_hint() {
    let json = r#"{"info":{"name":"c","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[]}"#;
    assert_eq!(parse_environment_file(json), Err(EnvFileError::Collection));
}

#[test]
fn garbage_is_an_error_not_an_empty_environment() {
    assert!(matches!(parse_environment_file("{ not json"), Err(EnvFileError::Invalid(_))));
    assert!(matches!(parse_environment_file(r#"{"name":"x"}"#), Err(EnvFileError::Invalid(_))));
    assert!(matches!(parse_environment_file("just some words"), Err(EnvFileError::Invalid(_))));
}

#[test]
fn export_carries_secret_values_and_reads_back_the_same() {
    let env = EnvironmentItem {
        id: "env-1".into(),
        name: "staging".into(),
        order: 1.0,
        path: "environments/staging.yaml".into(),
        extra: None,
        variables: vec![
            EnvVar { id: "a".into(), key: "baseUrl".into(), value: "https://s".into(), secret: false, extra: None },
            EnvVar { id: "b".into(), key: "token".into(), value: String::new(), secret: true, extra: None },
            EnvVar { id: "c".into(), key: "unfilled".into(), value: String::new(), secret: true, extra: None },
        ],
    };
    let secrets = HashMap::from([("b".to_string(), "s3cret".to_string())]);
    let json = export_postman_environment(&env, &secrets);
    assert!(json.contains("\"_postman_variable_scope\": \"environment\""));
    assert_eq!(
        parse_environment_file(&json).unwrap(),
        EnvFile {
            id: Some("env-1".into()),
            name: Some("staging".into()),
            variables: vec![v("baseUrl", "https://s", false, true), v("token", "s3cret", true, true), v("unfilled", "", true, true)],
        }
    );
}
