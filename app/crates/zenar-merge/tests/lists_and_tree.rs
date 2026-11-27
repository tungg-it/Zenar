mod common;
use common::*;
use zenar_format::*;
use zenar_merge::{merge, overwrite, ConflictKind};

fn ids(r: &RequestItem) -> Vec<&str> {
    r.headers.iter().map(|h| h.id.as_str()).collect()
}

fn fields(r: Result<impl std::fmt::Debug, Vec<zenar_merge::Conflict>>) -> Vec<(String, ConflictKind)> {
    r.unwrap_err().into_iter().map(|c| (c.field, c.kind)).collect()
}

// ---- headers (list by id) ----

#[test]
fn header_edits_to_different_ids_merge() {
    let (mut o, mut t) = (req(), req());
    o.headers[0].value = "xml".into();
    t.headers[1].value = "2".into();
    let m = merge(&req(), &o, &t).unwrap();
    assert_eq!((m.headers[0].value.as_str(), m.headers[1].value.as_str()), ("xml", "2"));
}

#[test]
fn header_edit_same_id_differently_conflicts() {
    let (mut o, mut t) = (req(), req());
    o.headers[0].value = "a".into();
    t.headers[0].enabled = false;
    assert_eq!(fields(merge(&req(), &o, &t)), vec![("headers/h1".into(), ConflictKind::BothChanged)]);
    assert_eq!(overwrite(&req(), &o, &t).headers[0], o.headers[0]);
}

#[test]
fn header_add_on_both_sides_merges_and_is_symmetric() {
    let (mut o, mut t) = (req(), req());
    o.headers.push(kv("h3", "A", "1"));
    t.headers.push(kv("h4", "B", "2"));
    let m = merge(&req(), &o, &t).unwrap();
    assert_eq!(ids(&m), vec!["h1", "h2", "h3", "h4"]);
    assert_eq!(merge(&req(), &t, &o).unwrap(), m);
}

#[test]
fn header_added_with_same_id_and_different_content_conflicts() {
    let (mut o, mut t) = (req(), req());
    o.headers.push(kv("h3", "A", "1"));
    t.headers.push(kv("h3", "A", "2"));
    assert_eq!(fields(merge(&req(), &o, &t)), vec![("headers/h3".into(), ConflictKind::BothChanged)]);
}

#[test]
fn header_delete_untouched_by_other_side_applies() {
    let (mut o, t) = (req(), req());
    o.headers.remove(0);
    assert_eq!(ids(&merge(&req(), &o, &t).unwrap()), vec!["h2"]);
    assert_eq!(ids(&merge(&req(), &t, &o).unwrap()), vec!["h2"]);
}

#[test]
fn header_deleted_on_both_sides_is_clean() {
    let mut x = req();
    x.headers.remove(0);
    assert_eq!(merge(&req(), &x, &x), Ok(x));
}

#[test]
fn header_edit_vs_delete_conflicts_either_direction() {
    let (mut o, mut t) = (req(), req());
    o.headers[0].value = "edited".into();
    t.headers.remove(0);
    assert_eq!(fields(merge(&req(), &o, &t)), vec![("headers/h1".into(), ConflictKind::EditVsDelete)]);
    assert_eq!(fields(merge(&req(), &t, &o)), vec![("headers/h1".into(), ConflictKind::EditVsDelete)]);
    // Overwrite: ours wins, so ours' edit survives / ours' delete applies.
    assert_eq!(ids(&overwrite(&req(), &o, &t)), vec!["h1", "h2"]);
    assert_eq!(ids(&overwrite(&req(), &t, &o)), vec!["h2"]);
}

#[test]
fn header_reorder_on_one_side_is_kept() {
    let (mut o, t) = (req(), req());
    o.headers.reverse();
    assert_eq!(ids(&merge(&req(), &o, &t).unwrap()), vec!["h2", "h1"]);
    assert_eq!(ids(&merge(&req(), &t, &o).unwrap()), vec!["h2", "h1"]);
}

#[test]
fn header_reorder_differently_conflicts_on_the_list() {
    let (mut o, mut t) = (req(), req());
    o.headers.push(kv("h3", "C", "3"));
    t.headers.push(kv("h3", "C", "3"));
    let mut b = req();
    b.headers.push(kv("h3", "C", "3"));
    o.headers.swap(0, 1); // h2 h1 h3
    t.headers.swap(1, 2); // h1 h3 h2
    assert_eq!(fields(merge(&b, &o, &t)), vec![("headers".into(), ConflictKind::BothChanged)]);
}

// ---- environment variables (by id) ----

fn env() -> EnvironmentItem {
    EnvironmentItem {
        id: "e1".into(),
        name: "dev".into(),
        order: 1.0,
        variables: vec![
            EnvVar { id: "v1".into(), key: "host".into(), value: "a".into(), secret: false, extra: None },
            EnvVar { id: "v2".into(), key: "token".into(), value: "".into(), secret: true, extra: None },
        ],
        path: "environments/dev.yaml".into(),
        extra: None,
    }
}

#[test]
fn environment_variables_merge_by_id() {
    let (mut o, mut t) = (env(), env());
    o.variables[0].value = "b".into();
    t.variables.push(EnvVar { id: "v3".into(), key: "x".into(), value: "1".into(), secret: false, extra: None });
    t.name = "development".into();
    let m = merge(&env(), &o, &t).unwrap();
    assert_eq!(m.variables.len(), 3);
    assert_eq!(m.variables[0].value, "b");
    assert_eq!(m.name, "development");
}

#[test]
fn environment_variable_conflicts() {
    let (mut o, mut t) = (env(), env());
    o.variables[0].value = "b".into();
    t.variables[0].value = "c".into();
    assert_eq!(fields(merge(&env(), &o, &t)), vec![("variables/v1".into(), ConflictKind::BothChanged)]);
    let mut t2 = env();
    t2.variables.remove(0);
    assert_eq!(fields(merge(&env(), &o, &t2)), vec![("variables/v1".into(), ConflictKind::EditVsDelete)]);
}

// ---- folder ----

#[test]
fn folder_fields_merge() {
    let b = FolderItem { id: "f1".into(), path: "users".into(), name: "Users".into(), order: 1.0, headers: vec![], auth: None, extra: None };
    let (mut o, mut t) = (b.clone(), b.clone());
    o.name = "People".into();
    t.order = 2.0;
    let m = merge(&b, &o, &t).unwrap();
    assert_eq!((m.name.as_str(), m.order), ("People", 2.0));
    t.name = "Humans".into();
    assert_eq!(fields(merge(&b, &o, &t)), vec![("name".into(), ConflictKind::BothChanged)]);
}

#[test]
fn folder_rename_follows_id_and_merges_with_other_sides_header() {
    let b = FolderItem { id: "f1".into(), path: "users".into(), name: "Users".into(), order: 1.0, headers: vec![], auth: None, extra: None };
    let (mut o, mut t) = (b.clone(), b.clone());
    t.path = "people".into();
    t.name = "People".into();
    o.order = 3.0;
    let m = merge(&b, &o, &t).unwrap();
    assert_eq!((m.path.as_str(), m.name.as_str(), m.order), ("people", "People", 3.0));
    o.path = "folks".into();
    assert!(merge(&b, &o, &t).is_err());
}

// ---- collection tree (by id, not path) ----

fn coll(requests: Vec<RequestItem>) -> CollectionData {
    CollectionData {
        name: "c".into(),
        read_only: false,
        requests,
        broken: vec![],
        folders: vec![FolderItem { id: "f1".into(), path: "users".into(), name: "Users".into(), order: 1.0, headers: vec![], auth: None, extra: None }],
        environments: vec![env()],
        headers: vec![],
        auth: None,
    }
}

fn req2() -> RequestItem {
    RequestItem { id: "r2".into(), name: "List".into(), order: 2.0, path: "users/list.yaml".into(), ..req() }
}

#[test]
fn rename_by_one_and_edit_by_other_merge_by_id() {
    let b = coll(vec![req(), req2()]);
    let (mut o, mut t) = (b.clone(), b.clone());
    o.requests[0].name = "Renamed".into();
    o.requests[0].path = "users/renamed.yaml".into();
    t.requests[0].url = "https://new".into();
    let m = merge(&b, &o, &t).unwrap();
    assert_eq!(m.requests.len(), 2);
    assert_eq!((m.requests[0].name.as_str(), m.requests[0].url.as_str()), ("Renamed", "https://new"));
    assert_eq!(m.requests[0].path, "users/renamed.yaml");
}

#[test]
fn move_by_one_and_edit_by_other_merge() {
    let b = coll(vec![req()]);
    let (mut o, mut t) = (b.clone(), b.clone());
    o.requests[0].folder = "archive".into();
    o.requests[0].path = "archive/get-user.yaml".into();
    t.requests[0].method = "POST".into();
    let m = merge(&b, &o, &t).unwrap();
    assert_eq!((m.requests[0].folder.as_str(), m.requests[0].method.as_str()), ("archive", "POST"));
}

#[test]
fn rename_theirs_only_takes_their_path() {
    let b = coll(vec![req()]);
    let (o, mut t) = (b.clone(), b.clone());
    t.requests[0].name = "T".into();
    t.requests[0].path = "users/t.yaml".into();
    assert_eq!(merge(&b, &o, &t).unwrap().requests[0].path, "users/t.yaml");
}

#[test]
fn edit_vs_delete_request_conflicts() {
    let b = coll(vec![req(), req2()]);
    let (mut o, mut t) = (b.clone(), b.clone());
    o.requests[0].url = "edited".into();
    t.requests.remove(0);
    assert_eq!(fields(merge(&b, &o, &t)), vec![("requests/r1".into(), ConflictKind::EditVsDelete)]);
}

#[test]
fn move_vs_delete_request_conflicts() {
    let b = coll(vec![req()]);
    let (mut t, mut o) = (b.clone(), b.clone());
    o.requests[0].folder = "elsewhere".into();
    t.requests.clear();
    assert_eq!(fields(merge(&b, &t, &o)), vec![("requests/r1".into(), ConflictKind::EditVsDelete)]);
    assert!(overwrite(&b, &t, &o).requests.is_empty());
    assert_eq!(overwrite(&b, &o, &t).requests[0].folder, "elsewhere");
}

#[test]
fn delete_of_untouched_request_applies_and_adds_merge() {
    let b = coll(vec![req(), req2()]);
    let (mut o, mut t) = (b.clone(), b.clone());
    o.requests.remove(1);
    t.requests.push(RequestItem { id: "r3".into(), name: "New".into(), ..req() });
    let m = merge(&b, &o, &t).unwrap();
    let got: Vec<_> = m.requests.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(got, vec!["r1", "r3"]);
}

#[test]
fn nested_conflicts_are_prefixed_with_the_request_id() {
    let b = coll(vec![req()]);
    let (mut o, mut t) = (b.clone(), b.clone());
    o.requests[0].url = "a".into();
    t.requests[0].url = "b".into();
    o.requests[0].headers[0].value = "x".into();
    t.requests[0].headers[0].value = "y".into();
    assert_eq!(
        fields(merge(&b, &o, &t)),
        vec![
            ("requests/r1/url".into(), ConflictKind::BothChanged),
            ("requests/r1/headers/h1".into(), ConflictKind::BothChanged)
        ]
    );
}
