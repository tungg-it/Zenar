//! Postman Collection v2.1 -> Zenar model (Format owns the conversion).
//!
//! `import_postman` is pure: it turns the JSON into Folders and Requests (ids come from the caller,
//! so tests are deterministic). `write_import` writes them with the canonical writers.
//! What the model cannot hold (unsupported body modes, OAuth, folder and
//! collection scripts...) is dropped and reported
//! in `warnings` instead of failing the import.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde_json::Value;

use crate::{
    create_request, save_folder, slugify, Auth, FolderItem, FormField, KeyValue, OpenError, RequestItem, Scripts,
};

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("not a valid Postman collection: {0}")]
    Invalid(String),
    #[error("unsupported Postman collection version (only v2.1 is supported): {0}")]
    UnsupportedVersion(String),
}

/// A converted Postman collection, ready to be written into a Collection.
#[derive(Debug, Clone, PartialEq)]
pub struct PostmanImport {
    pub name: String,
    /// Collection-level auth in Postman (apply as the Collection default when it has none).
    pub auth: Option<Auth>,
    /// Parents come before their children.
    pub folders: Vec<FolderItem>,
    pub requests: Vec<RequestItem>,
    pub warnings: Vec<String>,
    /// The `id` an item has in the file, by the id it got here (Requests and Folders). A Zenar
    /// export writes its own ids there, so a re-import can find the items it came from.
    pub source_ids: HashMap<String, String>,
}

pub fn import_postman(json: &str, new_id: &mut dyn FnMut() -> String) -> Result<PostmanImport, ImportError> {
    let root: Value = serde_json::from_str(json).map_err(|e| ImportError::Invalid(e.to_string()))?;
    // A Postman environment file (`values`, no `info`) picked as a collection: say so.
    if root.get("info").is_none() && root.get("values").is_some_and(Value::is_array) {
        return Err(ImportError::Invalid("this is a Postman environment file, not a collection. Use Import > Environment".into()));
    }
    let info = root.get("info").ok_or_else(|| ImportError::Invalid("missing info".into()))?;
    let schema = info.get("schema").and_then(Value::as_str).unwrap_or("");
    if !schema.contains("/v2.1") {
        return Err(ImportError::UnsupportedVersion(schema.to_string()));
    }
    let items = root
        .get("item")
        .and_then(Value::as_array)
        .ok_or_else(|| ImportError::Invalid("missing item list".into()))?;

    let mut cx = Cx { new_id, folders: vec![], requests: vec![], warnings: vec![], source_ids: HashMap::new() };
    let auth = root.get("auth").and_then(|a| cx.auth(a, "collection"));
    if !scripts(&root).is_empty() {
        cx.warnings.push("collection scripts are not supported and were skipped".into());
    }
    cx.walk(items, "");
    Ok(PostmanImport {
        name: info.get("name").and_then(Value::as_str).unwrap_or("Postman import").to_string(),
        auth,
        folders: cx.folders,
        requests: cx.requests,
        warnings: cx.warnings,
        source_ids: cx.source_ids,
    })
}

struct Cx<'a> {
    new_id: &'a mut dyn FnMut() -> String,
    folders: Vec<FolderItem>,
    requests: Vec<RequestItem>,
    warnings: Vec<String>,
    source_ids: HashMap<String, String>,
}

/// Postman keeps scripts in the item's `event` list: `prerequest` and `test` (its post-response
/// script), each with `script.exec` as a list of lines or one string.
fn scripts(item: &Value) -> Scripts {
    let mut out = Scripts::default();
    for e in item.get("event").and_then(Value::as_array).into_iter().flatten() {
        let code = match e.get("script").and_then(|sc| sc.get("exec")) {
            Some(Value::Array(lines)) => lines.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\n"),
            Some(Value::String(text)) => text.clone(),
            _ => continue,
        };
        if code.trim().is_empty() {
            continue;
        }
        match e.get("listen").and_then(Value::as_str) {
            Some("prerequest") => out.pre_request = code,
            Some("test") => out.post_response = code,
            _ => {}
        }
    }
    out
}

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

impl Cx<'_> {
    fn source(&mut self, item: &Value, id: &str) {
        let src = s(item, "id");
        if !src.is_empty() {
            self.source_ids.insert(id.to_string(), src);
        }
    }

    fn walk(&mut self, items: &[Value], folder: &str) {
        let mut used: HashSet<String> = HashSet::new();
        for (i, item) in items.iter().enumerate() {
            let order = (i + 1) as f64;
            let name = s(item, "name");
            if let Some(children) = item.get("item").and_then(Value::as_array) {
                // Unique, readable directory name among siblings.
                let base = slugify(&name);
                let mut slug = base.clone();
                let mut n = 2;
                while !used.insert(slug.clone()) {
                    slug = format!("{base}-{n}");
                    n += 1;
                }
                let path = if folder.is_empty() { slug } else { format!("{folder}/{slug}") };
                let auth = item.get("auth").and_then(|a| self.auth(a, &name));
                if !scripts(item).is_empty() {
                    self.warnings.push(format!("\"{name}\": folder scripts are not supported and were skipped"));
                }
                let id = format!("folder-{path}");
                self.source(item, &id);
                self.folders.push(FolderItem {
                    id,
                    path: path.clone(),
                    name,
                    order,
                    headers: vec![],
                    auth,
                    extra: None,
                });
                self.walk(children, &path);
            } else if let Some(req) = item.get("request") {
                let mut r = self.request(req, name, order, folder);
                r.scripts = scripts(item);
                self.source(item, &r.id);
                self.requests.push(r);
            }
        }
    }

    fn kv(&mut self, v: &Value) -> KeyValue {
        // A description is a string, or `{content}`; the UI reads it from `extra.description`.
        let description = v.get("description").and_then(|d| d.as_str().or_else(|| d.get("content").and_then(Value::as_str)));
        let extra = description.filter(|d| !d.is_empty()).map(|d| {
            let mut m = serde_yaml::Mapping::new();
            m.insert("description".into(), d.into());
            m
        });
        KeyValue {
            id: (self.new_id)(),
            key: s(v, "key"),
            value: s(v, "value"),
            enabled: !v.get("disabled").and_then(Value::as_bool).unwrap_or(false),
            extra,
        }
    }

    fn request(&mut self, req: &Value, name: String, order: f64, folder: &str) -> RequestItem {
        // Postman allows a bare string for a request ("GET" with that url is not expressible; treat as URL).
        let (method, url_v, header_v) = if let Some(u) = req.as_str() {
            ("GET".to_string(), Value::String(u.to_string()), Value::Null)
        } else {
            (
                req.get("method").and_then(Value::as_str).unwrap_or("GET").to_uppercase(),
                req.get("url").cloned().unwrap_or(Value::Null),
                req.get("header").cloned().unwrap_or(Value::Null),
            )
        };

        let (url, params) = match &url_v {
            Value::String(raw) => split_query(raw, self),
            Value::Object(_) => {
                let raw = s(&url_v, "raw");
                let query: Vec<Value> = url_v.get("query").and_then(Value::as_array).cloned().unwrap_or_default();
                let params = if query.is_empty() { split_query(&raw, self).1 } else { query.iter().map(|q| self.kv(q)).collect() };
                (split_query_url(&raw), params)
            }
            _ => (String::new(), vec![]),
        };
        // Postman keeps `:name` values in `url.variable`; they have no enabled flag.
        let path_variables = url_v
            .get("variable")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|v| KeyValue { enabled: true, ..self.kv(v) }).collect())
            .unwrap_or_default();

        let headers = header_v.as_array().map(|a| a.iter().map(|h| self.kv(h)).collect()).unwrap_or_default();
        let auth = req.get("auth").and_then(|a| self.auth(a, &name));
        let (body, body_type, body_extra) = self.body(req.get("body"), &name);

        RequestItem {
            id: (self.new_id)(),
            name,
            order,
            method,
            url,
            folder: folder.to_string(),
            params,
            path_variables,
            headers,
            auth,
            body,
            body_type,
            body_extra,
            captures: vec![],
            scripts: Scripts::default(),
            path: String::new(),
            extra: None,
        }
    }

    /// (content, type, extra keys of the body) — see `RequestItem::form_fields` & co. for the extras.
    fn body(&mut self, body: Option<&Value>, owner: &str) -> (Option<String>, Option<String>, Option<serde_yaml::Mapping>) {
        let Some(b) = body.filter(|b| b.is_object()) else { return (None, None, None) };
        let extra = |pairs: Vec<(&str, serde_yaml::Value)>| {
            let mut m = serde_yaml::Mapping::new();
            for (k, v) in pairs {
                m.insert(serde_yaml::Value::String(k.into()), v);
            }
            Some(m)
        };
        match b.get("mode").and_then(Value::as_str) {
            Some("raw") => {
                let lang = b.pointer("/options/raw/language").and_then(Value::as_str).unwrap_or("text");
                let kind = match lang {
                    "json" | "javascript" | "html" | "xml" => lang,
                    _ => "text",
                };
                (Some(s(b, "raw")), Some(kind.into()), None)
            }
            Some("urlencoded") => {
                let lines: Vec<String> = b
                    .get("urlencoded")
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter(|p| !p.get("disabled").and_then(Value::as_bool).unwrap_or(false))
                            .map(|p| format!("{}={}", s(p, "key"), s(p, "value")))
                            .collect()
                    })
                    .unwrap_or_default();
                (Some(lines.join("\n")), Some("form".into()), None)
            }
            Some("formdata") => {
                let fields: Vec<FormField> = b
                    .get("formdata")
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .map(|p| {
                                let file = p.get("type").and_then(Value::as_str) == Some("file");
                                // Postman keeps a file as `src` (a path, or a list of paths).
                                let src = match p.get("src") {
                                    Some(Value::Array(l)) => l.first().and_then(Value::as_str).unwrap_or("").to_string(),
                                    Some(Value::String(v)) => v.clone(),
                                    _ => String::new(),
                                };
                                FormField {
                                    id: (self.new_id)(),
                                    key: s(p, "key"),
                                    value: if file { src } else { s(p, "value") },
                                    kind: if file { "file".into() } else { "text".into() },
                                    enabled: !p.get("disabled").and_then(Value::as_bool).unwrap_or(false),
                                }
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let v = serde_yaml::to_value(&fields).unwrap_or(serde_yaml::Value::Null);
                (Some(String::new()), Some("formdata".into()), extra(vec![("fields", v)]))
            }
            Some("file") => {
                let src = b.pointer("/file/src").and_then(Value::as_str).unwrap_or("").to_string();
                (Some(String::new()), Some("binary".into()), extra(vec![("file", serde_yaml::Value::String(src))]))
            }
            Some("graphql") => {
                let gql = b.get("graphql").cloned().unwrap_or(Value::Null);
                let vars = s(&gql, "variables");
                let ex = if vars.trim().is_empty() { None } else { extra(vec![("variables", serde_yaml::Value::String(vars))]) };
                (Some(s(&gql, "query")), Some("graphql".into()), ex)
            }
            Some(other) => {
                self.warnings.push(format!("\"{owner}\": body mode '{other}' is not supported and was skipped"));
                (None, None, None)
            }
            None => (None, None, None),
        }
    }

    fn auth(&mut self, a: &Value, owner: &str) -> Option<Auth> {
        let kind = a.get("type").and_then(Value::as_str)?;
        // Postman stores params as [{key, value}] under a key named after the type.
        let get = |k: &str| -> Option<String> {
            a.get(kind)?.as_array()?.iter().find(|e| e.get("key").and_then(Value::as_str) == Some(k)).map(|e| match e.get("value") {
                Some(Value::String(v)) => v.clone(),
                Some(v) if !v.is_null() => v.to_string(),
                _ => String::new(),
            })
        };
        match kind {
            "noauth" => Some(Auth { kind: "none".into(), ..Default::default() }),
            "bearer" => Some(Auth { kind: "bearer".into(), token: Some(get("token").unwrap_or_default()), ..Default::default() }),
            "basic" => Some(Auth {
                kind: "basic".into(),
                username: Some(get("username").unwrap_or_default()),
                password: Some(get("password").unwrap_or_default()),
                ..Default::default()
            }),
            "apikey" => Some(Auth {
                kind: "apikey".into(),
                key: Some(get("key").unwrap_or_default()),
                value: Some(get("value").unwrap_or_default()),
                location: Some(get("in").filter(|l| l == "query").unwrap_or_else(|| "header".into())),
                ..Default::default()
            }),
            other => {
                self.warnings.push(format!("\"{owner}\": auth type '{other}' is not supported and was skipped"));
                None
            }
        }
    }
}

/// URL without its query string (the query lives in `params`).
fn split_query_url(raw: &str) -> String {
    let no_hash = raw.split('#').next().unwrap_or(raw);
    no_hash.split('?').next().unwrap_or(no_hash).to_string()
}

fn split_query(raw: &str, cx: &mut Cx) -> (String, Vec<KeyValue>) {
    let no_hash = raw.split('#').next().unwrap_or(raw);
    let params = match no_hash.split_once('?') {
        Some((_, q)) => q
            .split('&')
            .filter(|p| !p.is_empty())
            .map(|p| {
                let (k, v) = p.split_once('=').unwrap_or((p, ""));
                KeyValue { id: (cx.new_id)(), key: k.into(), value: v.into(), enabled: true, extra: None }
            })
            .collect(),
        None => vec![],
    };
    (split_query_url(raw), params)
}

/// Move the whole import into one new Folder named after the Postman collection, at the top-level
/// directory `slug` with `order`. The Postman collection's auth goes on that Folder.
pub fn wrap_in_folder(imp: &PostmanImport, slug: &str, order: f64) -> PostmanImport {
    let nest = |path: &str| if path.is_empty() { slug.to_string() } else { format!("{slug}/{path}") };
    let top = FolderItem {
        id: format!("folder-{slug}"),
        path: slug.to_string(),
        name: imp.name.clone(),
        order,
        headers: vec![],
        auth: imp.auth.clone(),
        extra: None,
    };
    let folders = std::iter::once(top)
        .chain(imp.folders.iter().map(|f| {
            let path = nest(&f.path);
            FolderItem { id: format!("folder-{path}"), path, ..f.clone() }
        }))
        .collect();
    let requests = imp.requests.iter().map(|r| RequestItem { folder: nest(&r.folder), ..r.clone() }).collect();
    PostmanImport { name: imp.name.clone(), auth: None, folders, requests, warnings: imp.warnings.clone(), source_ids: HashMap::new() }
}

/// `ours` updated from `file`, a Request of a re-imported Zenar export. `exported` is `ours` as it
/// comes back from an export and import (headers inherited from Folders copied in, `zn` written as
/// `pm`, new row ids...): a part of `file` that still equals it was not changed in the file and
/// keeps `ours` exactly. Only the parts that differ come from the file. What Postman cannot hold
/// (captures, the place in the tree, the order) always stays as is.
pub fn updated_request(ours: &RequestItem, exported: &RequestItem, file: &RequestItem) -> RequestItem {
    let mut r = ours.clone();
    macro_rules! take {
        ($($f:ident),+) => {
            if !same(&($(&file.$f,)+), &($(&exported.$f,)+)) {
                $(r.$f = file.$f.clone();)+
            }
        };
    }
    take!(name);
    take!(method);
    take!(url);
    take!(auth);
    take!(body, body_type, body_extra);
    take!(scripts);
    if !same(&file.params, &exported.params) {
        r.params = keep_ids(&ours.params, &file.params);
    }
    if !same(&file.path_variables, &exported.path_variables) {
        r.path_variables = keep_ids(&ours.path_variables, &file.path_variables);
    }
    if !same(&file.headers, &exported.headers) {
        // Headers the export copied in from the Collection and Folders stay inherited.
        let inherited: Vec<&KeyValue> = exported.headers.iter().filter(|h| !ours.headers.iter().any(|o| same_kv(o, h))).collect();
        let own: Vec<KeyValue> = file.headers.iter().filter(|h| !inherited.iter().any(|i| same_kv(i, h))).cloned().collect();
        r.headers = keep_ids(&ours.headers, &own);
    }
    r
}

fn same_kv(a: &KeyValue, b: &KeyValue) -> bool {
    a.key.eq_ignore_ascii_case(&b.key) && a.value == b.value && a.enabled == b.enabled
}

/// Rows from the file keep the id (and description) of the row they replace with the same key.
fn keep_ids(ours: &[KeyValue], file: &[KeyValue]) -> Vec<KeyValue> {
    let mut used = HashSet::new();
    file.iter()
        .map(|f| match ours.iter().enumerate().find(|(i, o)| !used.contains(i) && o.key == f.key) {
            Some((i, o)) => {
                used.insert(i);
                KeyValue { id: o.id.clone(), extra: f.extra.clone().or_else(|| o.extra.clone()), ..f.clone() }
            }
            None => f.clone(),
        })
        .collect()
}

/// Equal once generated ids are left out (row ids, form field ids).
fn same<T: serde::Serialize>(a: &T, b: &T) -> bool {
    fn strip(v: Value) -> Value {
        match v {
            Value::Object(m) => Value::Object(m.into_iter().filter(|(k, _)| k != "id").map(|(k, v)| (k, strip(v))).collect()),
            Value::Array(a) => Value::Array(a.into_iter().map(strip).collect()),
            v => v,
        }
    }
    let norm = |x: &T| strip(serde_json::to_value(x).unwrap_or(Value::Null));
    norm(a) == norm(b)
}

/// Write the Folders then the Requests of an import into the Collection at `root`. Does not commit.
/// An existing `folder.yaml` is kept as is; Request files get `-2`, `-3`... on name collisions.
/// Returns the relative paths written (for `git add`).
pub fn write_import(root: &Path, imp: &PostmanImport) -> Result<Vec<String>, OpenError> {
    let mut paths = Vec::new();
    for f in &imp.folders {
        let rel = format!("{}/folder.yaml", f.path);
        if !root.join(&rel).exists() {
            save_folder(root, f)?;
            paths.push(rel);
        }
    }
    for r in &imp.requests {
        paths.push(create_request(root, r)?);
    }
    Ok(paths)
}
