//! Importing an environment file (ticket #24): fill Secrets of a matching Environment, or plan a new one.
use zenar_format::env_file::{EnvFile, EnvFileVar};
use zenar_format::{CollectionData, EnvVar, EnvironmentItem};
use zenar_store::env_import::{
    apply_environment_import, plan_environment_import, EnvImportPlan, ImportTarget, SecretFill, SkipReason, SkippedVar,
    TargetChoice,
};
use zenar_store::secrets::{account, set_secret, MemorySecrets, SecretStore};

const C: &str = "col";

fn var(id: &str, key: &str, value: &str, secret: bool) -> EnvVar {
    EnvVar { id: id.into(), key: key.into(), value: value.into(), secret, extra: None }
}

fn staging() -> EnvironmentItem {
    EnvironmentItem {
        id: "env-staging".into(), name: "staging".into(), order: 2.0, path: "environments/staging.yaml".into(), extra: None,
        variables: vec![var("v1", "baseUrl", "https://staging", false), var("v2", "token", "", true), var("v3", "password", "", true)],
    }
}

fn collection() -> CollectionData {
    CollectionData {
        name: "c".into(), read_only: false, requests: vec![], broken: vec![], folders: vec![],
        environments: vec![staging()], headers: vec![], auth: None,
    }
}

fn fv(key: &str, value: &str, secret: bool) -> EnvFileVar {
    EnvFileVar { key: key.into(), value: value.into(), secret, enabled: true }
}

fn file(id: Option<&str>, name: Option<&str>, variables: Vec<EnvFileVar>) -> EnvFile {
    EnvFile { id: id.map(Into::into), name: name.map(Into::into), variables }
}

fn ids() -> impl FnMut() -> String {
    let mut n = 0;
    move || {
        n += 1;
        format!("id-{n}")
    }
}

fn plan(store: &MemorySecrets, f: &EnvFile, choice: TargetChoice) -> EnvImportPlan {
    plan_environment_import(store, C, &collection(), f, &choice, "app.env", &mut ids())
}

fn existing() -> ImportTarget {
    ImportTarget::Existing { environment_id: "env-staging".into(), environment_name: "staging".into() }
}

fn fill(var_id: &str, key: &str, value: &str, overwrites: bool) -> SecretFill {
    SecretFill { var_id: var_id.into(), key: key.into(), value: value.into(), overwrites }
}

fn skip(key: &str, reason: SkipReason) -> SkippedVar {
    SkippedVar { key: key.into(), reason }
}

#[test]
fn a_teammates_export_fills_only_secrets_of_the_matching_environment() {
    let store = MemorySecrets::default();
    let f = file(
        Some("env-staging"),
        Some("renamed by them"),
        vec![fv("baseUrl", "https://old", false), fv("token", "t0k", true), fv("extra", "x", false), fv("password", "", true)],
    );
    let p = plan(&store, &f, TargetChoice::Auto);
    assert_eq!(p.target, existing());
    assert_eq!(p.fills, vec![fill("v2", "token", "t0k", false)]);
    assert_eq!(
        p.skipped,
        vec![skip("baseUrl", SkipReason::Shared), skip("extra", SkipReason::NotInEnvironment), skip("password", SkipReason::NoValue)]
    );
    // Planning writes nothing.
    assert_eq!(store.get(&account(C, "env-staging", "v2")).unwrap(), None);

    apply_environment_import(&store, C, &p).unwrap();
    assert_eq!(store.get(&account(C, "env-staging", "v2")).unwrap().as_deref(), Some("t0k"));
}

#[test]
fn a_file_without_a_known_id_matches_by_name() {
    let f = file(Some("postman-uuid"), Some("staging"), vec![fv("token", "t", true)]);
    assert_eq!(plan(&MemorySecrets::default(), &f, TargetChoice::Auto).target, existing());
}

#[test]
fn the_repo_decides_what_is_a_secret() {
    // `.env` marks nothing as secret; `password` is a Secret in the repo, `baseUrl` is not.
    let f = file(None, None, vec![fv("password", "p", false), fv("baseUrl", "b", true)]);
    let p = plan(&MemorySecrets::default(), &f, TargetChoice::Existing { environment_id: "env-staging".into() });
    assert_eq!(p.fills, vec![fill("v3", "password", "p", false)]);
    assert_eq!(p.skipped, vec![skip("baseUrl", SkipReason::Shared)]);
}

#[test]
fn a_different_stored_value_is_flagged_as_overwritten_and_the_same_one_is_not() {
    let store = MemorySecrets::default();
    set_secret(&store, C, "env-staging", "v2", "mine").unwrap();
    set_secret(&store, C, "env-staging", "v3", "same").unwrap();
    let f = file(Some("env-staging"), None, vec![fv("token", "theirs", true), fv("password", "same", true)]);
    let p = plan(&store, &f, TargetChoice::Auto);
    assert_eq!(p.fills, vec![fill("v2", "token", "theirs", true), fill("v3", "password", "same", false)]);
}

#[test]
fn disabled_variables_are_skipped() {
    let f = file(Some("env-staging"), None, vec![EnvFileVar { key: "token".into(), value: "t".into(), secret: true, enabled: false }]);
    let p = plan(&MemorySecrets::default(), &f, TargetChoice::Auto);
    assert!(p.fills.is_empty());
    assert_eq!(p.skipped, vec![skip("token", SkipReason::Disabled)]);
}

#[test]
fn an_unknown_file_plans_a_new_environment_with_its_secrets() {
    let f = file(
        Some("postman-uuid"),
        Some("production"),
        vec![
            fv("baseUrl", "https://prod", false),
            fv("token", "t", true),
            EnvFileVar { key: "old".into(), value: "x".into(), secret: false, enabled: false },
        ],
    );
    let p = plan(&MemorySecrets::default(), &f, TargetChoice::Auto);
    let ImportTarget::New { environment } = &p.target else { panic!("expected a new Environment, got {:?}", p.target) };
    assert_eq!(environment.name, "production");
    assert_ne!(environment.id, "postman-uuid");
    assert_eq!(environment.order, 3.0);
    assert_eq!(environment.variables, vec![var("id-1", "baseUrl", "https://prod", false), var("id-2", "token", "t", true)]);
    assert_eq!(p.fills, vec![fill("id-2", "token", "t", false)]);
    assert_eq!(p.skipped, vec![skip("old", SkipReason::Disabled)]);
}

#[test]
fn a_dotenv_into_a_new_environment_takes_the_file_name() {
    let p = plan(&MemorySecrets::default(), &file(None, None, vec![fv("A", "1", false)]), TargetChoice::New);
    let ImportTarget::New { environment } = &p.target else { panic!() };
    assert_eq!(environment.name, "app.env");
}

#[test]
fn choosing_new_never_touches_a_matching_environment() {
    let f = file(Some("env-staging"), Some("staging"), vec![fv("token", "t", true)]);
    let p = plan(&MemorySecrets::default(), &f, TargetChoice::New);
    assert!(matches!(p.target, ImportTarget::New { .. }));
    assert!(apply_environment_import(&MemorySecrets::default(), C, &p).is_err());
}
