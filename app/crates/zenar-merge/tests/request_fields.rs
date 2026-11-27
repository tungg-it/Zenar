mod common;
use common::*;
use zenar_format::RequestItem;
use zenar_merge::{merge, overwrite, ConflictKind};

type Edit = fn(&mut RequestItem, &str);

fn set_method(r: &mut RequestItem, v: &str) { r.method = v.into() }
fn set_url(r: &mut RequestItem, v: &str) { r.url = v.into() }
fn set_name(r: &mut RequestItem, v: &str) { r.name = v.into() }
fn set_order(r: &mut RequestItem, v: &str) { r.order = v.parse().unwrap() }
fn set_folder(r: &mut RequestItem, v: &str) { r.folder = v.into() }
fn set_body(r: &mut RequestItem, v: &str) { r.body = Some(v.into()) }
fn set_body_type(r: &mut RequestItem, v: &str) { r.body_type = Some(v.into()) }

/// (field name, editor, value A, value B)
fn cases() -> Vec<(&'static str, Edit, &'static str, &'static str)> {
    vec![
        ("method", set_method, "POST", "PUT"),
        ("url", set_url, "https://a", "https://b"),
        ("name", set_name, "A", "B"),
        ("order", set_order, "2.5", "3.5"),
        ("folder", set_folder, "x", "y"),
        ("body", set_body, "{\"a\":1}", "{\"b\":2}"),
        ("body", set_body_type, "text", "xml"),
    ]
}

#[test]
fn one_side_changes_field_other_untouched() {
    for (name, edit, a, _) in cases() {
        let base = req();
        let mut changed = req();
        edit(&mut changed, a);
        assert_eq!(merge(&base, &changed, &base), Ok(changed.clone()), "ours {name}");
        assert_eq!(merge(&base, &base, &changed), Ok(changed.clone()), "theirs {name}");
    }
}

#[test]
fn both_change_same_field_to_same_value_is_clean() {
    for (name, edit, a, _) in cases() {
        let mut x = req();
        edit(&mut x, a);
        assert_eq!(merge(&req(), &x, &x), Ok(x.clone()), "{name}");
    }
}

#[test]
fn both_change_same_field_differently_conflicts_and_overwrite_takes_ours() {
    for (name, edit, a, b) in cases() {
        let (mut o, mut t) = (req(), req());
        edit(&mut o, a);
        edit(&mut t, b);
        let c = merge(&req(), &o, &t).unwrap_err();
        assert_eq!(c.len(), 1, "{name}");
        assert_eq!(c[0].field, name);
        assert_eq!(c[0].kind, ConflictKind::BothChanged);
        assert_eq!(overwrite(&req(), &o, &t), o, "{name}");
    }
}

#[test]
fn different_fields_merge_automatically() {
    let (mut o, mut t) = (req(), req());
    o.url = "https://new".into();
    t.method = "DELETE".into();
    let m = merge(&req(), &o, &t).unwrap();
    assert_eq!((m.url.as_str(), m.method.as_str()), ("https://new", "DELETE"));
}

#[test]
fn overwrite_keeps_non_conflicting_changes_of_theirs() {
    let (mut o, mut t) = (req(), req());
    o.url = "mine".into();
    t.url = "theirs".into();
    t.method = "PUT".into();
    let m = overwrite(&req(), &o, &t);
    assert_eq!((m.url.as_str(), m.method.as_str()), ("mine", "PUT"));
}

#[test]
fn multiple_conflicts_are_all_reported() {
    let (mut o, mut t) = (req(), req());
    o.url = "a".into();
    t.url = "b".into();
    o.method = "POST".into();
    t.method = "PUT".into();
    let fields: Vec<_> = merge(&req(), &o, &t).unwrap_err().into_iter().map(|c| c.field).collect();
    assert_eq!(fields, vec!["method", "url"]);
}

fn capture(id: &str, name: &str, path: &str) -> zenar_format::Capture {
    zenar_format::Capture { id: id.into(), name: name.into(), path: path.into(), extra: None }
}

#[test]
fn captures_added_on_both_sides_merge_automatically() {
    let (mut o, mut t) = (req(), req());
    o.captures.push(capture("c1", "token", "$.token"));
    t.captures.push(capture("c2", "uid", "$.id"));
    let m = merge(&req(), &o, &t).unwrap();
    let names: Vec<_> = m.captures.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["token", "uid"]);
}

#[test]
fn same_capture_edited_differently_conflicts_on_captures_id() {
    let mut base = req();
    base.captures.push(capture("c1", "token", "$.token"));
    let (mut o, mut t) = (base.clone(), base.clone());
    o.captures[0].path = "$.a".into();
    t.captures[0].path = "$.b".into();
    let c = merge(&base, &o, &t).unwrap_err();
    assert_eq!(c.len(), 1);
    assert_eq!(c[0].field, "captures/c1");
    assert_eq!(overwrite(&base, &o, &t).captures[0].path, "$.a");
}

#[test]
fn edits_to_different_captures_merge() {
    let mut base = req();
    base.captures.push(capture("c1", "a", "$.a"));
    base.captures.push(capture("c2", "b", "$.b"));
    let (mut o, mut t) = (base.clone(), base.clone());
    o.captures[0].path = "$.x".into();
    t.captures[1].name = "bb".into();
    let m = merge(&base, &o, &t).unwrap();
    assert_eq!((m.captures[0].path.as_str(), m.captures[1].name.as_str()), ("$.x", "bb"));
}
