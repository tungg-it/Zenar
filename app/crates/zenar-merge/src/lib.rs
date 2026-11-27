//! Merge module (ADR 0002): pure 3-way merge per Field over the model types of `zenar-format`.
//! No I/O, no Git. `merge(base, ours, theirs)` returns the merged value or every conflicting
//! Field; `overwrite` resolves conflicts in favour of `ours` and keeps all other changes.
//!
//! Field paths (`Conflict::field`): `method`, `url`, `name`, `order`, `folder`, `body`,
//! `scripts`, `extra`, `headers/<id>`, `headers` (list order), `variables/<id>`, and inside a collection
//! `requests/<id>/<field>`, `folders/<path>/<field>`, `environments/<id>/<field>`.
//! An element added/removed as a whole is reported as `requests/<id>` etc.

use std::collections::{HashMap, HashSet};

use zenar_format::{CollectionData, EnvVar, EnvironmentItem, FolderItem, KeyValue, RequestItem};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictKind {
    /// Both sides changed (or added) the same Field to different values.
    BothChanged,
    /// One side edited/moved an element the other side deleted.
    EditVsDelete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conflict {
    pub field: String,
    pub kind: ConflictKind,
}

/// Types that can be merged Field by Field.
pub trait Mergeable: Clone {
    /// Merge into a value; conflicts are pushed to `cx` and resolved as `ours` in the value.
    fn merge_into(base: &Self, ours: &Self, theirs: &Self, prefix: &str, cx: &mut Vec<Conflict>) -> Self;
}

/// Merged value, or all conflicting Fields.
pub fn merge<T: Mergeable>(base: &T, ours: &T, theirs: &T) -> Result<T, Vec<Conflict>> {
    let mut cx = Vec::new();
    let v = T::merge_into(base, ours, theirs, "", &mut cx);
    if cx.is_empty() { Ok(v) } else { Err(cx) }
}

/// Overwrite: conflicting Fields take `ours`; every other change of `theirs` is kept.
pub fn overwrite<T: Mergeable>(base: &T, ours: &T, theirs: &T) -> T {
    T::merge_into(base, ours, theirs, "", &mut Vec::new())
}

fn join(prefix: &str, name: &str) -> String {
    if prefix.is_empty() { name.to_string() } else { format!("{prefix}/{name}") }
}

fn scalar<T: Clone + PartialEq>(b: &T, o: &T, t: &T, field: String, cx: &mut Vec<Conflict>) -> T {
    if o == t || t == b {
        o.clone()
    } else if o == b {
        t.clone()
    } else {
        cx.push(Conflict { field, kind: ConflictKind::BothChanged });
        o.clone()
    }
}

type Nested<'a, T> = &'a dyn Fn(&T, &T, &T, &str, &mut Vec<Conflict>) -> T;

/// Id-keyed list merge. Elements present in all three are merged with `nested` (or as a whole).
fn merge_list<T: Clone + PartialEq>(
    b: &[T],
    o: &[T],
    t: &[T],
    id: fn(&T) -> &str,
    field: &str,
    cx: &mut Vec<Conflict>,
    nested: Option<Nested<T>>,
) -> Vec<T> {
    fn idx<'a, T>(l: &'a [T], id: fn(&T) -> &str) -> HashMap<&'a str, &'a T> {
        l.iter().map(|x| (id(x), x)).collect()
    }
    let (bm, om, tm) = (idx(b, id), idx(o, id), idx(t, id));
    let mut all: Vec<&str> = Vec::new();
    let mut seen = HashSet::new();
    for l in [b, o, t] {
        for x in l {
            if seen.insert(id(x)) {
                all.push(id(x));
            }
        }
    }

    let mut outcome: HashMap<&str, T> = HashMap::new();
    let mut common: HashSet<&str> = HashSet::new();
    for k in all {
        let path = join(field, k);
        let edit_delete = |cx: &mut Vec<Conflict>| cx.push(Conflict { field: path.clone(), kind: ConflictKind::EditVsDelete });
        match (bm.get(k), om.get(k), tm.get(k)) {
            (Some(bv), Some(ov), Some(tv)) => {
                common.insert(k);
                let v = match nested {
                    Some(f) => f(bv, ov, tv, &path, cx),
                    None => scalar(*bv, *ov, *tv, path.clone(), cx),
                };
                outcome.insert(k, v);
            }
            (Some(bv), Some(ov), None) => {
                if ov != bv {
                    edit_delete(cx);
                    outcome.insert(k, (*ov).clone());
                }
            }
            (Some(bv), None, Some(tv)) => {
                if tv != bv {
                    edit_delete(cx);
                }
            }
            (Some(_), None, None) => {}
            (None, Some(ov), Some(tv)) => {
                let v = if ov == tv {
                    (*ov).clone()
                } else {
                    cx.push(Conflict { field: path, kind: ConflictKind::BothChanged });
                    (*ov).clone()
                };
                outcome.insert(k, v);
            }
            (None, Some(ov), None) => {
                outcome.insert(k, (*ov).clone());
            }
            (None, None, Some(tv)) => {
                outcome.insert(k, (*tv).clone());
            }
            (None, None, None) => unreachable!(),
        }
    }

    // Order of the elements every version still has.
    fn proj<'a, T>(l: &'a [T], id: fn(&T) -> &str, common: &HashSet<&str>) -> Vec<&'a str> {
        l.iter().map(id).filter(|k| common.contains(k)).collect()
    }
    let (cb, co, ct) = (proj(b, id, &common), proj(o, id, &common), proj(t, id, &common));
    let seq = if co == ct || ct == cb {
        co
    } else if co == cb {
        ct
    } else {
        cx.push(Conflict { field: field.to_string(), kind: ConflictKind::BothChanged });
        co
    };

    // Elements not in `common`, grouped by the common element preceding them in their own list.
    type Chunks<'a> = HashMap<Option<&'a str>, Vec<&'a str>>;
    fn chunks<'a, T>(l: &'a [T], id: fn(&T) -> &str, common: &HashSet<&str>, keep: &dyn Fn(&str) -> bool) -> Chunks<'a> {
        let mut m: Chunks = HashMap::new();
        let mut anchor: Option<&str> = None;
        for x in l {
            let k = id(x);
            if common.contains(k) {
                anchor = Some(k);
            } else if keep(k) {
                m.entry(anchor).or_default().push(k);
            }
        }
        m
    }
    let keep = |k: &str| outcome.contains_key(k);
    let (oc, tc) = (chunks(o, id, &common, &keep), chunks(t, id, &common, &keep));
    fn combine<'a>(a: Option<&Vec<&'a str>>, b: Option<&Vec<&'a str>>) -> Vec<&'a str> {
        match (a, b) {
            (Some(a), Some(b)) if a != b => {
                let mut v: Vec<&str> = a.iter().chain(b.iter()).copied().collect();
                v.sort();
                v.dedup();
                v
            }
            (Some(a), _) => a.clone(),
            (None, Some(b)) => b.clone(),
            (None, None) => vec![],
        }
    }

    let mut ids: Vec<&str> = combine(oc.get(&None), tc.get(&None));
    for k in &seq {
        ids.push(k);
        ids.extend(combine(oc.get(&Some(*k)), tc.get(&Some(*k))));
    }
    ids.into_iter().map(|k| outcome[k].clone()).collect()
}

fn kv_id(x: &KeyValue) -> &str { &x.id }
fn var_id(x: &EnvVar) -> &str { &x.id }
fn req_id(x: &RequestItem) -> &str { &x.id }
fn folder_key(x: &FolderItem) -> &str { &x.id }
fn env_id(x: &EnvironmentItem) -> &str { &x.id }

impl Mergeable for KeyValue {
    fn merge_into(b: &Self, o: &Self, t: &Self, prefix: &str, cx: &mut Vec<Conflict>) -> Self {
        scalar(b, o, t, prefix.to_string(), cx)
    }
}

impl Mergeable for RequestItem {
    fn merge_into(b: &Self, o: &Self, t: &Self, p: &str, cx: &mut Vec<Conflict>) -> Self {
        let name = scalar(&b.name, &o.name, &t.name, join(p, "name"), cx);
        let order = scalar(&b.order.to_bits(), &o.order.to_bits(), &t.order.to_bits(), join(p, "order"), cx);
        let method = scalar(&b.method, &o.method, &t.method, join(p, "method"), cx);
        let url = scalar(&b.url, &o.url, &t.url, join(p, "url"), cx);
        let folder = scalar(&b.folder, &o.folder, &t.folder, join(p, "folder"), cx);
        let params = merge_list(&b.params, &o.params, &t.params, kv_id, &join(p, "params"), cx, None);
        let path_variables = merge_list(&b.path_variables, &o.path_variables, &t.path_variables, kv_id, &join(p, "path_variables"), cx, None);
        let headers = merge_list(&b.headers, &o.headers, &t.headers, kv_id, &join(p, "headers"), cx, None);
        let auth = scalar(&b.auth, &o.auth, &t.auth, join(p, "auth"), cx);
        // The body is one Field: content, type and its unknown keys travel together.
        let body_of = |r: &RequestItem| (r.body.clone(), r.body_type.clone(), r.body_extra.clone());
        let (body, body_type, body_extra) = scalar(&body_of(b), &body_of(o), &body_of(t), join(p, "body"), cx);
        let captures = merge_list(&b.captures, &o.captures, &t.captures, |c| &c.id, &join(p, "captures"), cx, None);
        let scripts = scalar(&b.scripts, &o.scripts, &t.scripts, join(p, "scripts"), cx);
        let extra = scalar(&b.extra, &o.extra, &t.extra, join(p, "extra"), cx);
        // `path` is derived from name + folder; follow whichever side produced the merged location.
        let path = if name == t.name && folder == t.folder && !(name == o.name && folder == o.folder) {
            t.path.clone()
        } else {
            o.path.clone()
        };
        RequestItem {
            id: o.id.clone(),
            name,
            order: f64::from_bits(order),
            method,
            url,
            folder,
            params,
            path_variables,
            headers,
            auth,
            body,
            body_type,
            body_extra,
            captures,
            scripts,
            path,
            extra,
        }
    }
}

impl Mergeable for FolderItem {
    fn merge_into(b: &Self, o: &Self, t: &Self, p: &str, cx: &mut Vec<Conflict>) -> Self {
        FolderItem {
            id: o.id.clone(),
            path: scalar(&b.path, &o.path, &t.path, join(p, "path"), cx),
            name: scalar(&b.name, &o.name, &t.name, join(p, "name"), cx),
            order: f64::from_bits(scalar(&b.order.to_bits(), &o.order.to_bits(), &t.order.to_bits(), join(p, "order"), cx)),
            headers: merge_list(&b.headers, &o.headers, &t.headers, kv_id, &join(p, "headers"), cx, None),
            auth: scalar(&b.auth, &o.auth, &t.auth, join(p, "auth"), cx),
            extra: scalar(&b.extra, &o.extra, &t.extra, join(p, "extra"), cx),
        }
    }
}

impl Mergeable for EnvVar {
    fn merge_into(b: &Self, o: &Self, t: &Self, prefix: &str, cx: &mut Vec<Conflict>) -> Self {
        scalar(b, o, t, prefix.to_string(), cx)
    }
}

impl Mergeable for EnvironmentItem {
    fn merge_into(b: &Self, o: &Self, t: &Self, p: &str, cx: &mut Vec<Conflict>) -> Self {
        EnvironmentItem {
            id: o.id.clone(),
            name: scalar(&b.name, &o.name, &t.name, join(p, "name"), cx),
            order: f64::from_bits(scalar(&b.order.to_bits(), &o.order.to_bits(), &t.order.to_bits(), join(p, "order"), cx)),
            variables: merge_list(&b.variables, &o.variables, &t.variables, var_id, &join(p, "variables"), cx, None),
            path: o.path.clone(),
            extra: scalar(&b.extra, &o.extra, &t.extra, join(p, "extra"), cx),
        }
    }
}

/// Tree level: Requests and Environments are matched by id (so rename and move are Field edits,
/// not delete+add), Folders by id (`folder.yaml`; rename/move change `path`). Delete vs edit conflicts.
/// `name`, `read_only` and `broken` come from `ours`.
impl Mergeable for CollectionData {
    fn merge_into(b: &Self, o: &Self, t: &Self, p: &str, cx: &mut Vec<Conflict>) -> Self {
        let requests = merge_list(&b.requests, &o.requests, &t.requests, req_id, &join(p, "requests"), cx, Some(&|b, o, t, path, cx| RequestItem::merge_into(b, o, t, path, cx)));
        let folders = merge_list(&b.folders, &o.folders, &t.folders, folder_key, &join(p, "folders"), cx, Some(&|b, o, t, path, cx| FolderItem::merge_into(b, o, t, path, cx)));
        let environments = merge_list(&b.environments, &o.environments, &t.environments, env_id, &join(p, "environments"), cx, Some(&|b, o, t, path, cx| EnvironmentItem::merge_into(b, o, t, path, cx)));
        CollectionData {
            name: o.name.clone(),
            read_only: o.read_only,
            requests,
            broken: o.broken.clone(),
            folders,
            environments,
            headers: merge_list(&b.headers, &o.headers, &t.headers, kv_id, &join(p, "headers"), cx, None),
            auth: scalar(&b.auth, &o.auth, &t.auth, join(p, "auth"), cx),
        }
    }
}
