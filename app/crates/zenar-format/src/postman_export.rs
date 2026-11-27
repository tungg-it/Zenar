//! Zenar Collection -> Postman Collection v2.1 (the reverse of `postman::import_postman`).
//!
//! Postman has no Collection or Folder headers: they are copied into each Request, the way Zenar
//! layers them on Send. Scripts use `pm.` instead of `zn.`. Captures have no Postman equivalent
//! and are reported in `warnings`. Environments are exported one by one (`env_file`).

use serde_json::{json, Map, Value};

use crate::{Auth, CollectionData, FolderItem, KeyValue, RequestItem, Scripts};

const SCHEMA: &str = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

pub struct PostmanExport {
    pub json: String,
    /// What Postman cannot hold (dropped, not fatal).
    pub warnings: Vec<String>,
}

pub fn export_postman(data: &CollectionData) -> PostmanExport {
    let mut warnings = Vec::new();
    let mut root = Map::new();
    root.insert("info".into(), json!({ "name": data.name, "schema": SCHEMA }));
    root.insert("item".into(), Value::Array(items(data, "", &mut warnings)));
    if let Some(a) = &data.auth {
        root.insert("auth".into(), auth(a));
    }
    let json = serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default() + "\n";
    PostmanExport { json, warnings }
}

fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(p, _)| p)
}

/// Folders and Requests directly inside `folder`, in the order the tree shows them.
fn items(data: &CollectionData, folder: &str, warnings: &mut Vec<String>) -> Vec<Value> {
    enum Node<'a> {
        Folder(&'a FolderItem),
        Request(&'a RequestItem),
    }
    let mut nodes: Vec<(f64, &str, Node)> = data
        .folders
        .iter()
        .filter(|f| parent_of(&f.path) == folder)
        .map(|f| (f.order, f.name.as_str(), Node::Folder(f)))
        .chain(data.requests.iter().filter(|r| r.folder == folder).map(|r| (r.order, r.name.as_str(), Node::Request(r))))
        .collect();
    nodes.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(b.1)));
    nodes
        .into_iter()
        .map(|(_, _, n)| match n {
            Node::Folder(f) => {
                let mut o = Map::new();
                // Zenar ids, so importing the file back into this Collection updates in place.
                o.insert("id".into(), json!(f.id));
                o.insert("name".into(), json!(f.name));
                o.insert("item".into(), Value::Array(items(data, &f.path, warnings)));
                if let Some(a) = &f.auth {
                    o.insert("auth".into(), auth(a));
                }
                Value::Object(o)
            }
            Node::Request(r) => request(data, r, warnings),
        })
        .collect()
}

fn request(data: &CollectionData, r: &RequestItem, warnings: &mut Vec<String>) -> Value {
    if !r.captures.is_empty() {
        warnings.push(format!("\"{}\": {} capture(s) skipped (Postman has no captures)", r.name, r.captures.len()));
    }
    let mut req = Map::new();
    req.insert("method".into(), json!(r.method));
    req.insert("header".into(), Value::Array(headers(data, r).iter().map(kv).collect()));
    req.insert("url".into(), url(r));
    if let Some(a) = &r.auth {
        req.insert("auth".into(), auth(a));
    }
    if let Some(b) = body(r) {
        req.insert("body".into(), b);
    }
    let mut item = Map::new();
    item.insert("id".into(), json!(r.id));
    item.insert("name".into(), json!(r.name));
    item.insert("request".into(), Value::Object(req));
    let events = events(&r.scripts);
    if !events.is_empty() {
        item.insert("event".into(), Value::Array(events));
    }
    Value::Object(item)
}

/// Collection, then each Folder down to the Request's, then the Request: a later enabled header
/// replaces an earlier one with the same name, as on Send.
fn headers(data: &CollectionData, r: &RequestItem) -> Vec<KeyValue> {
    let mut chain: Vec<&FolderItem> = data
        .folders
        .iter()
        .filter(|f| r.folder == f.path || r.folder.starts_with(&format!("{}/", f.path)))
        .collect();
    chain.sort_by_key(|f| f.path.len());
    let inherited = data.headers.iter().chain(chain.iter().flat_map(|f| f.headers.iter())).filter(|h| h.enabled);
    let mut out: Vec<KeyValue> = Vec::new();
    for h in inherited.chain(r.headers.iter()) {
        if h.enabled {
            out.retain(|o| !(o.enabled && o.key.eq_ignore_ascii_case(&h.key)));
        }
        out.push(h.clone());
    }
    out
}

fn kv(h: &KeyValue) -> Value {
    let mut o = Map::new();
    o.insert("key".into(), json!(h.key));
    o.insert("value".into(), json!(h.value));
    if !h.enabled {
        o.insert("disabled".into(), json!(true));
    }
    if let Some(d) = h.extra.as_ref().and_then(|m| m.get("description")).and_then(|d| d.as_str()).filter(|d| !d.is_empty()) {
        o.insert("description".into(), json!(d));
    }
    Value::Object(o)
}

fn url(r: &RequestItem) -> Value {
    let query: Vec<String> = r
        .params
        .iter()
        .filter(|p| p.enabled && !p.key.is_empty())
        .map(|p| if p.value.is_empty() { p.key.clone() } else { format!("{}={}", p.key, p.value) })
        .collect();
    let raw = if query.is_empty() { r.url.clone() } else { format!("{}?{}", r.url, query.join("&")) };
    let mut o = Map::new();
    o.insert("raw".into(), json!(raw));
    if !r.params.is_empty() {
        o.insert("query".into(), Value::Array(r.params.iter().map(kv).collect()));
    }
    if !r.path_variables.is_empty() {
        o.insert("variable".into(), Value::Array(r.path_variables.iter().map(|v| kv(&KeyValue { enabled: true, ..v.clone() })).collect()));
    }
    Value::Object(o)
}

fn body(r: &RequestItem) -> Option<Value> {
    let text = r.body.clone().unwrap_or_default();
    Some(match r.body_type.as_deref()? {
        kind @ ("json" | "javascript" | "html" | "xml" | "text") => {
            json!({ "mode": "raw", "raw": text, "options": { "raw": { "language": kind } } })
        }
        "form" => {
            let pairs: Vec<Value> = text
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|l| {
                    let (k, v) = l.split_once('=').unwrap_or((l, ""));
                    json!({ "key": k, "value": v })
                })
                .collect();
            json!({ "mode": "urlencoded", "urlencoded": pairs })
        }
        "formdata" => {
            let fields: Vec<Value> = r
                .form_fields()
                .iter()
                .map(|f| {
                    let mut o = Map::new();
                    o.insert("key".into(), json!(f.key));
                    if f.kind == "file" {
                        o.insert("type".into(), json!("file"));
                        o.insert("src".into(), json!(f.value));
                    } else {
                        o.insert("type".into(), json!("text"));
                        o.insert("value".into(), json!(f.value));
                    }
                    if !f.enabled {
                        o.insert("disabled".into(), json!(true));
                    }
                    Value::Object(o)
                })
                .collect();
            json!({ "mode": "formdata", "formdata": fields })
        }
        "binary" => json!({ "mode": "file", "file": { "src": r.body_file().unwrap_or_default() } }),
        "graphql" => {
            json!({ "mode": "graphql", "graphql": { "query": text, "variables": r.graphql_variables().unwrap_or_default() } })
        }
        _ => return None,
    })
}

fn auth(a: &Auth) -> Value {
    let param = |k: &str, v: &Option<String>| json!({ "key": k, "value": v.clone().unwrap_or_default(), "type": "string" });
    match a.kind.as_str() {
        "bearer" => json!({ "type": "bearer", "bearer": [param("token", &a.token)] }),
        "basic" => json!({ "type": "basic", "basic": [param("username", &a.username), param("password", &a.password)] }),
        "apikey" => json!({
            "type": "apikey",
            "apikey": [param("key", &a.key), param("value", &a.value), param("in", &Some(a.location.clone().unwrap_or_else(|| "header".into())))],
        }),
        _ => json!({ "type": "noauth" }),
    }
}

fn events(s: &Scripts) -> Vec<Value> {
    [("prerequest", &s.pre_request), ("test", &s.post_response)]
        .into_iter()
        .filter(|(_, code)| !code.trim().is_empty())
        .map(|(listen, code)| {
            let exec: Vec<String> = to_pm(code).lines().map(str::to_string).collect();
            json!({ "listen": listen, "script": { "type": "text/javascript", "exec": exec } })
        })
        .collect()
}

/// `zn.` -> `pm.` where `zn` is a whole identifier (Postman only knows `pm`; Zenar runs both).
fn to_pm(code: &str) -> String {
    let mut out = String::with_capacity(code.len());
    let mut prev: Option<char> = None;
    let mut rest = code;
    while let Some(c) = rest.chars().next() {
        let starts_word = !prev.is_some_and(|p| p.is_alphanumeric() || p == '_' || p == '$' || p == '.');
        if starts_word && rest.starts_with("zn.") {
            out.push_str("pm.");
            rest = &rest[3..];
            prev = Some('.');
            continue;
        }
        out.push(c);
        prev = Some(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}
