mod common;
use common::*;
use zenar_format::{open_collection, EnvVar, EnvironmentItem};
use zenar_service::SharedSave;

fn var(id: &str, key: &str, value: &str) -> EnvVar {
    EnvVar { id: id.into(), key: key.into(), value: value.into(), secret: false, extra: None }
}

fn env() -> EnvironmentItem {
    EnvironmentItem {
        id: "env-dev".into(), name: "dev".into(), order: 1.0, path: String::new(), extra: None,
        variables: vec![
            var("v1", "base", "http://localhost"),
            EnvVar { id: "v2".into(), key: "token".into(), value: "hunter2".into(), secret: true, extra: None },
        ],
    }
}

fn loaded(w: &Member) -> EnvironmentItem {
    open_collection(&w.root).unwrap().environments.remove(0)
}

#[test]
fn saved_environment_is_shared_but_secret_value_never_reaches_a_commit() {
    let w = world();
    assert_eq!(w.a.service().save_environment(None, &env(), false).unwrap(), SharedSave::Saved);
    assert!(w.a.root.join("environments/dev.yaml").is_file());
    // Message follows the template: Create|Update "<name>" (<folder>/)
    assert_eq!(w.a.git_out(&["log", "-1", "--format=%s"]).trim(), "Create \"dev\" (environments/)");
    assert!(!w.a.git_out(&["log", "-p", "--all"]).contains("hunter2"));
    assert!(!std::fs::read_to_string(w.a.root.join("environments/dev.yaml")).unwrap().contains("hunter2"));

    let b = w.b.service().sync().unwrap();
    let e = &b.data.environments[0];
    assert_eq!(e.name, "dev");
    assert!(e.variables[1].secret);
    assert_eq!(e.variables[1].value, "");
}

#[test]
fn saving_environment_after_another_member_pushed_still_succeeds() {
    let w = world();
    w.b.service().save(zenar_service::Change::Create(req("r1", "Login", ""))).unwrap();
    w.a.service().save_environment(None, &env(), false).unwrap();
    let r = w.b.service().sync().unwrap();
    assert_eq!((r.data.requests.len(), r.data.environments.len()), (1, 1));
}

#[test]
fn concurrent_edits_to_different_variables_are_merged_not_overwritten() {
    let w = world();
    w.a.service().save_environment(None, &env(), false).unwrap();
    w.b.service().sync().unwrap();
    let (base_a, base_b) = (loaded(&w.a), loaded(&w.b));

    let mut a = base_a.clone();
    a.variables[0].value = "http://a.example".into();
    assert_eq!(w.a.service().save_environment(Some(&base_a), &a, false).unwrap(), SharedSave::Saved);

    let mut b = base_b.clone();
    b.variables.push(var("v3", "extra", "1"));
    assert_eq!(w.b.service().save_environment(Some(&base_b), &b, false).unwrap(), SharedSave::Saved);

    let merged = open_collection(&w.b.root).unwrap().environments.remove(0);
    assert_eq!(merged.variables.len(), 3, "B's new variable kept");
    assert_eq!(merged.variables[0].value, "http://a.example", "A's edit kept");
    assert_eq!(w.b.git_out(&["log", "-1", "--format=%s"]).trim(), "Update \"dev\" (environments/)");
}

#[test]
fn concurrent_edits_to_the_same_variable_are_a_conflict_until_overwritten() {
    let w = world();
    w.a.service().save_environment(None, &env(), false).unwrap();
    w.b.service().sync().unwrap();
    let (base_a, base_b) = (loaded(&w.a), loaded(&w.b));

    let mut a = base_a.clone();
    a.variables[0].value = "http://a.example".into();
    w.a.service().save_environment(Some(&base_a), &a, false).unwrap();

    let mut b = base_b.clone();
    b.variables[0].value = "http://b.example".into();
    let r = w.b.service().save_environment(Some(&base_b), &b, false).unwrap();
    assert_eq!(r, SharedSave::Conflict { fields: vec!["variables/v1".into()] });
    assert_eq!(loaded(&w.b).variables[0].value, "http://a.example", "nothing was written");

    assert_eq!(w.b.service().save_environment(Some(&base_b), &b, true).unwrap(), SharedSave::Saved);
    assert_eq!(loaded(&w.a).variables[0].value, "http://a.example");
    w.a.service().sync().unwrap();
    assert_eq!(loaded(&w.a).variables[0].value, "http://b.example");
}

#[test]
fn editing_an_environment_another_member_deleted_is_a_conflict() {
    let w = world();
    w.a.service().save_environment(None, &env(), false).unwrap();
    w.b.service().sync().unwrap();
    let base_b = loaded(&w.b);
    w.a.git_out(&["rm", "-q", "environments/dev.yaml"]);
    w.a.git_out(&["commit", "-q", "-m", "Delete \"dev\" (environments/)"]);
    w.a.git_out(&["push", "-q", "origin", "HEAD"]);

    let mut b = base_b.clone();
    b.name = "renamed".into();
    let r = w.b.service().save_environment(Some(&base_b), &b, false).unwrap();
    assert_eq!(r, SharedSave::Conflict { fields: vec!["environments/env-dev".into()] });
}

#[test]
fn importing_an_unknown_environment_file_shares_it_but_never_its_secret_values() {
    use zenar_format::env_file::parse_environment_file;
    use zenar_store::env_import::{plan_environment_import, ImportTarget, TargetChoice};
    use zenar_store::secrets::MemorySecrets;

    let w = world();
    let file = parse_environment_file(
        r#"{"name":"production","values":[{"key":"base","value":"https://prod","type":"default"},{"key":"token","value":"hunter2","type":"secret"}]}"#,
    )
    .unwrap();
    let data = open_collection(&w.a.root).unwrap();
    let mut n = 0;
    let plan = plan_environment_import(&MemorySecrets::default(), "c", &data, &file, &TargetChoice::Auto, "x", &mut || {
        n += 1;
        format!("id-{n}")
    });
    let ImportTarget::New { environment } = plan.target else { panic!("expected a new Environment") };

    assert_eq!(w.a.service().save_environment(None, &environment, false).unwrap(), SharedSave::Saved);
    assert!(!w.a.git_out(&["log", "-p", "--all"]).contains("hunter2"));
    let b = w.b.service().sync().unwrap();
    let e = &b.data.environments[0];
    assert_eq!((e.name.as_str(), e.variables[1].secret, e.variables[1].value.as_str()), ("production", true, ""));
}

#[test]
fn deleted_environment_is_gone_for_every_member() {
    let w = world();
    w.a.service().save_environment(None, &env(), false).unwrap();
    w.b.service().sync().unwrap();

    assert_eq!(w.b.service().delete_environment("env-dev").unwrap(), SharedSave::Saved);
    assert_eq!(w.b.git_out(&["log", "-1", "--format=%s"]).trim(), "Delete \"dev\" (environments/)");
    assert!(!w.b.root.join("environments/dev.yaml").exists());
    assert!(w.a.service().sync().unwrap().data.environments.is_empty());

    // Deleting it again (already gone on the remote) commits nothing.
    let before = w.a.git_out(&["rev-parse", "HEAD"]);
    assert_eq!(w.a.service().delete_environment("env-dev").unwrap(), SharedSave::Saved);
    assert_eq!(w.a.git_out(&["rev-parse", "HEAD"]), before);
}

#[test]
fn reordering_is_saving_the_order_field() {
    let w = world();
    w.a.service().save_environment(None, &env(), false).unwrap();
    let prod = EnvironmentItem { id: "env-prod".into(), name: "prod".into(), order: 2.0, variables: vec![], ..env() };
    w.a.service().save_environment(None, &prod, false).unwrap();

    let dev = loaded(&w.a);
    let moved = EnvironmentItem { order: 3.0, ..dev.clone() };
    assert_eq!(w.a.service().save_environment(Some(&dev), &moved, false).unwrap(), SharedSave::Saved);
    let names: Vec<String> = w.b.service().sync().unwrap().data.environments.into_iter().map(|e| e.name).collect();
    assert_eq!(names, ["prod", "dev"]);
}
