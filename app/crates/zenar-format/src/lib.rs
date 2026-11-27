//! Collection Format (ADR 0003). Minimal read side for the tracer: open a Collection directory.
//! Framework-independent (no Tauri).

pub mod env_file;
pub mod postman;
pub mod postman_export;

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use ts_rs::TS;

/// Highest `formatVersion` major this build can edit.
pub const SUPPORTED_MAJOR: u64 = 1;

#[derive(Debug, thiserror::Error)]
pub enum OpenError {
    #[error("not a Zenar Collection (missing collection.yaml): {0}")]
    MissingManifest(String),
    #[error("invalid collection.yaml: {0}")]
    InvalidManifest(String),
    #[error("Collection is read-only: formatVersion is newer than this app supports, update the app")]
    ReadOnly,
    #[error("request not found: {0}")]
    RequestNotFound(String),
    #[error("cannot serialize: {0}")]
    Serialize(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct KeyValue {
    pub id: String,
    pub key: String,
    pub value: String,
    pub enabled: bool,
    /// Unknown fields, preserved verbatim on write.
    #[serde(default)]
    #[ts(type = "Record<string, unknown> | null", optional)]
    pub extra: Option<Mapping>,
}

/// Auth setting on a Collection, Folder or Request. `kind` is `none` (stops inheritance), `bearer`,
/// `basic` or `apikey`. Unused fields stay `None`. Unknown fields inside `auth` are not preserved.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct Auth {
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub password: Option<String>,
    /// API key name (header or query parameter name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub value: Option<String>,
    /// API key placement: `header` (default) or `query`.
    #[serde(rename = "in", default, skip_serializing_if = "Option::is_none")]
    #[ts(rename = "in", optional)]
    pub location: Option<String>,
}

/// JavaScript run around a Send, with the `zn` API (Postman's `pm` as alias): `pre_request` before the Request is
/// composed, `post_response` once the response arrived. Empty text means no script.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct Scripts {
    #[serde(default)]
    pub pre_request: String,
    #[serde(default)]
    pub post_response: String,
}

impl Scripts {
    pub fn is_empty(&self) -> bool {
        self.pre_request.trim().is_empty() && self.post_response.trim().is_empty()
    }
}

/// A rule that saves a value from the response into a Captured Variable (kept only on this machine).
/// `path` is a JSONPath evaluated against the JSON response body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct Capture {
    pub id: String,
    /// Variable name later Requests use as `{{name}}`.
    pub name: String,
    pub path: String,
    /// Unknown fields, preserved verbatim on write.
    #[serde(flatten, default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "Record<string, unknown> | null", optional)]
    pub extra: Option<Mapping>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct RequestItem {
    pub id: String,
    pub name: String,
    pub order: f64,
    pub method: String,
    pub url: String,
    /// Folder path relative to the Collection root ("" for the root), `/`-separated.
    pub folder: String,
    #[serde(default)]
    pub params: Vec<KeyValue>,
    /// Values of the `:name` path segments of `url`, by key (Postman's Path Variables).
    #[serde(default)]
    pub path_variables: Vec<KeyValue>,
    pub headers: Vec<KeyValue>,
    #[serde(default)]
    #[ts(optional)]
    pub auth: Option<Auth>,
    pub body: Option<String>,
    #[serde(default)]
    pub body_type: Option<String>,
    #[serde(default)]
    #[ts(type = "Record<string, unknown> | null", optional)]
    pub body_extra: Option<Mapping>,
    /// Rules that capture response values into Captured Variables.
    #[serde(default)]
    pub captures: Vec<Capture>,
    /// Pre-request / post-response scripts.
    #[serde(default)]
    pub scripts: Scripts,
    /// File path relative to the Collection root, `/`-separated.
    #[serde(default)]
    pub path: String,
    /// Unknown top-level fields, preserved verbatim on write.
    #[serde(default)]
    #[ts(type = "Record<string, unknown> | null", optional)]
    pub extra: Option<Mapping>,
}

/// One multipart/form-data field of a `formdata` body, stored under `body.fields`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct FormField {
    pub id: String,
    pub key: String,
    /// Text value, or the local file path when `type` is `file`.
    pub value: String,
    /// `text` or `file`.
    #[serde(rename = "type", default = "text_kind")]
    #[ts(rename = "type")]
    pub kind: String,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn text_kind() -> String {
    "text".into()
}

/// Typed access to the parts of a body kept in `body_extra` (`body_type` says which apply):
/// `formdata` keeps its fields under `fields`, `binary` the file path under `file`, `graphql` the
/// variables (JSON text) under `variables`.
impl RequestItem {
    pub fn form_fields(&self) -> Vec<FormField> {
        self.body_extra
            .as_ref()
            .and_then(|m| m.get("fields"))
            .and_then(|v| serde_yaml::from_value(v.clone()).ok())
            .unwrap_or_default()
    }

    pub fn body_file(&self) -> Option<String> {
        self.extra_str("file")
    }

    pub fn graphql_variables(&self) -> Option<String> {
        self.extra_str("variables")
    }

    fn extra_str(&self, key: &str) -> Option<String> {
        self.body_extra.as_ref()?.get(key)?.as_str().map(str::to_string).filter(|s| !s.trim().is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct BrokenFile {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct CollectionData {
    pub name: String,
    pub read_only: bool,
    pub requests: Vec<RequestItem>,
    pub broken: Vec<BrokenFile>,
    pub folders: Vec<FolderItem>,
    pub environments: Vec<EnvironmentItem>,
    /// Headers every Request in the Collection inherits (from `collection.yaml`).
    #[serde(default)]
    pub headers: Vec<KeyValue>,
    /// Auth every Request inherits unless a Folder or the Request sets its own.
    #[serde(default)]
    #[ts(optional)]
    pub auth: Option<Auth>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct FolderItem {
    /// Stable id from `folder.yaml`; `path:<path>` for a legacy Folder that has none yet.
    pub id: String,
    /// Path relative to the Collection root, `/`-separated.
    pub path: String,
    /// From `folder.yaml`; the directory name when there is none.
    pub name: String,
    pub order: f64,
    /// Headers inherited by Requests in this Folder and its subfolders.
    #[serde(default)]
    pub headers: Vec<KeyValue>,
    #[serde(default)]
    #[ts(optional)]
    pub auth: Option<Auth>,
    #[serde(default)]
    #[ts(type = "Record<string, unknown> | null", optional)]
    pub extra: Option<Mapping>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct EnvVar {
    pub id: String,
    pub key: String,
    /// Never persisted when `secret` is true.
    pub value: String,
    pub secret: bool,
    #[serde(default)]
    #[ts(type = "Record<string, unknown> | null", optional)]
    pub extra: Option<Mapping>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct EnvironmentItem {
    pub id: String,
    pub name: String,
    pub order: f64,
    pub variables: Vec<EnvVar>,
    /// File path relative to the Collection root; empty for a new Environment.
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    #[ts(type = "Record<string, unknown> | null", optional)]
    pub extra: Option<Mapping>,
}

#[derive(Deserialize)]
struct Manifest {
    #[serde(rename = "formatVersion")]
    format_version: serde_yaml::Value,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    headers: Vec<RawKeyValue>,
    #[serde(default)]
    auth: Option<Auth>,
}

#[derive(Deserialize, Serialize)]
struct RawKeyValue {
    id: String,
    key: String,
    #[serde(default)]
    value: String,
    #[serde(default = "yes")]
    enabled: bool,
    #[serde(flatten)]
    extra: Mapping,
}

#[derive(Deserialize, Serialize)]
struct RawBody {
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(default)]
    content: String,
    #[serde(flatten)]
    extra: Mapping,
}

#[derive(Deserialize, Serialize)]
struct RawRequest {
    id: String,
    name: String,
    #[serde(default)]
    order: f64,
    method: String,
    url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    params: Vec<RawKeyValue>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    path_variables: Vec<RawKeyValue>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    headers: Vec<RawKeyValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auth: Option<Auth>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    body: Option<RawBody>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    captures: Vec<Capture>,
    #[serde(default, skip_serializing_if = "RawScripts::is_empty")]
    scripts: RawScripts,
    #[serde(flatten)]
    extra: Mapping,
}

/// `scripts` as written in a Request file: an empty script is left out. The UI always gets both.
#[derive(Default, Deserialize, Serialize)]
struct RawScripts {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pre_request: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    post_response: String,
}

impl RawScripts {
    fn is_empty(&self) -> bool {
        self.pre_request.is_empty() && self.post_response.is_empty()
    }
}

fn opt(m: Mapping) -> Option<Mapping> {
    if m.is_empty() { None } else { Some(m) }
}

#[derive(Deserialize, Serialize)]
struct RawFolder {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(default)]
    order: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    headers: Vec<RawKeyValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auth: Option<Auth>,
    #[serde(flatten)]
    extra: Mapping,
}

fn kv_from_raw(v: Vec<RawKeyValue>) -> Vec<KeyValue> {
    v.into_iter().map(|h| KeyValue { id: h.id, key: h.key, value: h.value, enabled: h.enabled, extra: opt(h.extra) }).collect()
}

fn kv_to_raw(v: &[KeyValue]) -> Vec<RawKeyValue> {
    v.iter()
        .map(|h| RawKeyValue {
            id: h.id.clone(),
            key: h.key.clone(),
            value: h.value.clone(),
            enabled: h.enabled,
            extra: h.extra.clone().unwrap_or_default(),
        })
        .collect()
}

#[derive(Deserialize, Serialize)]
struct RawEnvVar {
    id: String,
    key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(default)]
    secret: bool,
    #[serde(flatten)]
    extra: Mapping,
}

#[derive(Deserialize, Serialize)]
struct RawEnvironment {
    id: String,
    name: String,
    #[serde(default)]
    order: f64,
    #[serde(default)]
    variables: Vec<RawEnvVar>,
    #[serde(flatten)]
    extra: Mapping,
}

fn yes() -> bool {
    true
}

fn major(v: &serde_yaml::Value) -> Option<u64> {
    match v {
        serde_yaml::Value::Number(n) => n.as_f64().map(|f| f.trunc() as u64),
        serde_yaml::Value::String(s) => s.split('.').next()?.parse().ok(),
        _ => None,
    }
}

pub fn open_collection(root: &Path) -> Result<CollectionData, OpenError> {
    let manifest_path = root.join("collection.yaml");
    if !manifest_path.is_file() {
        return Err(OpenError::MissingManifest(root.display().to_string()));
    }
    let manifest: Manifest = serde_yaml::from_str(&fs::read_to_string(&manifest_path)?)
        .map_err(|e| OpenError::InvalidManifest(e.to_string()))?;
    let major = major(&manifest.format_version)
        .ok_or_else(|| OpenError::InvalidManifest("unreadable formatVersion".into()))?;
    let name = manifest.name.unwrap_or_else(|| {
        root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    });

    let mut acc = Acc::default();
    walk(root, root, &mut acc)?;
    let Acc { mut requests, broken, mut folders, mut environments } = acc;
    let by_order = |a: f64, b: f64| a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal);
    folders.sort_by(|a, b| by_order(a.order, b.order).then_with(|| a.name.cmp(&b.name)));
    environments.sort_by(|a, b| by_order(a.order, b.order).then_with(|| a.name.cmp(&b.name)));
    requests.sort_by(|a, b| {
        a.order.partial_cmp(&b.order).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.name.cmp(&b.name))
    });

    Ok(CollectionData {
        name,
        read_only: major > SUPPORTED_MAJOR,
        requests,
        broken,
        folders,
        environments,
        headers: kv_from_raw(manifest.headers),
        auth: manifest.auth,
    })
}

#[derive(Default)]
struct Acc {
    requests: Vec<RequestItem>,
    broken: Vec<BrokenFile>,
    folders: Vec<FolderItem>,
    environments: Vec<EnvironmentItem>,
}

fn rel_of(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/")
}

fn read_yaml<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    fs::read_to_string(path).map_err(|e| e.to_string()).and_then(|s| serde_yaml::from_str(&s).map_err(|e| e.to_string()))
}

fn walk(root: &Path, dir: &Path, acc: &mut Acc) -> Result<(), OpenError> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.collect::<Result<_, _>>()?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let fname = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if fname.starts_with('.') {
                continue;
            }
            if dir == root && fname == "environments" {
                walk_environments(root, &path, acc)?;
                continue;
            }
            let rel = rel_of(root, &path);
            let meta = path.join("folder.yaml");
            let (mut name, mut order, mut extra) = (fname.clone(), 0.0, None);
            let (mut headers, mut auth) = (Vec::new(), None);
            let mut id = format!("path:{rel}");
            if meta.is_file() {
                match read_yaml::<RawFolder>(&meta) {
                    Ok(f) => {
                        if let Some(i) = f.id {
                            id = i;
                        }
                        name = f.name.unwrap_or(name);
                        order = f.order;
                        extra = opt(f.extra);
                        headers = kv_from_raw(f.headers);
                        auth = f.auth;
                    }
                    Err(error) => acc.broken.push(BrokenFile { path: format!("{rel}/folder.yaml"), error }),
                }
            }
            acc.folders.push(FolderItem { id, path: rel, name, order, headers, auth, extra });
            walk(root, &path, acc)?;
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
            continue;
        }
        if fname == "folder.yaml" || (dir == root && fname == "collection.yaml") {
            continue;
        }
        let (requests, broken) = (&mut acc.requests, &mut acc.broken);
        let rel_str = rel_of(root, &path);
        let folder = rel_str.rsplit_once('/').map(|(f, _)| f.to_string()).unwrap_or_default();
        match fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|s| serde_yaml::from_str::<RawRequest>(&s).map_err(|e| e.to_string()))
        {
            Ok(r) => requests.push(RequestItem {
                id: r.id,
                name: r.name,
                order: r.order,
                method: r.method,
                url: r.url,
                folder,
                params: kv_from_raw(r.params),
                path_variables: kv_from_raw(r.path_variables),
                headers: kv_from_raw(r.headers),
                auth: r.auth,
                body_type: r.body.as_ref().and_then(|b| b.kind.clone()),
                body_extra: r.body.as_ref().and_then(|b| opt(b.extra.clone())),
                body: r.body.map(|b| b.content),
                captures: r.captures,
                scripts: Scripts { pre_request: r.scripts.pre_request, post_response: r.scripts.post_response },
                path: rel_str,
                extra: opt(r.extra),
            }),
            Err(error) => broken.push(BrokenFile { path: rel_str, error }),
        }
    }
    Ok(())
}

fn walk_environments(root: &Path, dir: &Path, acc: &mut Acc) -> Result<(), OpenError> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.collect::<Result<_, _>>()?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
            continue;
        }
        let rel = rel_of(root, &path);
        match read_yaml::<RawEnvironment>(&path) {
            Ok(e) => acc.environments.push(EnvironmentItem {
                id: e.id,
                name: e.name,
                order: e.order,
                variables: e
                    .variables
                    .into_iter()
                    .map(|v| EnvVar { id: v.id, key: v.key, value: v.value.unwrap_or_default(), secret: v.secret, extra: opt(v.extra) })
                    .collect(),
                path: rel,
                extra: opt(e.extra),
            }),
            Err(error) => acc.broken.push(BrokenFile { path: rel, error }),
        }
    }
    Ok(())
}

fn to_raw(r: &RequestItem) -> RawRequest {
    RawRequest {
        id: r.id.clone(),
        name: r.name.clone(),
        order: r.order,
        method: r.method.clone(),
        url: r.url.clone(),
        params: kv_to_raw(&r.params),
        path_variables: kv_to_raw(&r.path_variables),
        headers: kv_to_raw(&r.headers),
        auth: r.auth.clone(),
        body: r.body.as_ref().map(|c| RawBody {
            kind: r.body_type.clone(),
            content: c.clone(),
            extra: r.body_extra.clone().unwrap_or_default(),
        }),
        captures: r.captures.clone(),
        scripts: RawScripts { pre_request: r.scripts.pre_request.clone(), post_response: r.scripts.post_response.clone() },
        extra: r.extra.clone().unwrap_or_default(),
    }
}

/// The one canonical text form of a Request file (ADR 0003).
pub fn canonical_request_yaml(r: &RequestItem) -> Result<String, OpenError> {
    serde_yaml::to_string(&to_raw(r)).map_err(|e| OpenError::Serialize(e.to_string()))
}

fn read_manifest(root: &Path) -> Result<(Manifest, u64), OpenError> {
    let manifest_path = root.join("collection.yaml");
    if !manifest_path.is_file() {
        return Err(OpenError::MissingManifest(root.display().to_string()));
    }
    let manifest: Manifest = serde_yaml::from_str(&fs::read_to_string(&manifest_path)?)
        .map_err(|e| OpenError::InvalidManifest(e.to_string()))?;
    let m = major(&manifest.format_version)
        .ok_or_else(|| OpenError::InvalidManifest("unreadable formatVersion".into()))?;
    Ok((manifest, m))
}

/// Save (Request) in place, located by id. Returns the relative path written.
pub fn save_request(root: &Path, item: &RequestItem) -> Result<String, OpenError> {
    let (_, m) = read_manifest(root)?;
    if m > SUPPORTED_MAJOR {
        return Err(OpenError::ReadOnly);
    }
    let existing = open_collection(root)?
        .requests
        .into_iter()
        .find(|r| r.id == item.id)
        .ok_or_else(|| OpenError::RequestNotFound(item.id.clone()))?;
    fs::write(root.join(&existing.path), canonical_request_yaml(item)?)?;
    Ok(existing.path)
}

/// Lowercase ASCII slug of a Request name; `request` when nothing usable remains.
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "request".into() } else { out }
}

fn check_folder(folder: &str) -> Result<(), OpenError> {
    if folder.split('/').any(|s| s == ".." || s == ".") || folder.starts_with('/') || folder.contains('\\') {
        return Err(OpenError::Serialize(format!("invalid folder path: {folder}")));
    }
    Ok(())
}

/// Create a new Request file named by slug inside `item.folder`, suffixing `-2`, `-3`... on collision
/// (case-insensitive). Returns the relative path written.
pub fn create_request(root: &Path, item: &RequestItem) -> Result<String, OpenError> {
    let (_, m) = read_manifest(root)?;
    if m > SUPPORTED_MAJOR {
        return Err(OpenError::ReadOnly);
    }
    check_folder(&item.folder)?;
    let dir = if item.folder.is_empty() { root.to_path_buf() } else { root.join(&item.folder) };
    fs::create_dir_all(&dir)?;
    let taken: Vec<String> = fs::read_dir(&dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_lowercase())
        .collect();
    let base = slugify(&item.name);
    let reserved = |f: &str| (item.folder.is_empty() && f == "collection.yaml") || f == "folder.yaml";
    let mut n = 1;
    let file = loop {
        let f = if n == 1 { format!("{base}.yaml") } else { format!("{base}-{n}.yaml") };
        if !taken.contains(&f) && !reserved(&f) {
            break f;
        }
        n += 1;
    };
    let rel = if item.folder.is_empty() { file } else { format!("{}/{}", item.folder, file) };
    fs::write(root.join(&rel), canonical_request_yaml(item)?)?;
    Ok(rel)
}

fn writable(root: &Path) -> Result<(), OpenError> {
    let (_, m) = read_manifest(root)?;
    if m > SUPPORTED_MAJOR { Err(OpenError::ReadOnly) } else { Ok(()) }
}

/// Write `folder.yaml` for a Folder (canonical form).
pub fn save_folder(root: &Path, f: &FolderItem) -> Result<(), OpenError> {
    writable(root)?;
    check_folder(&f.path)?;
    let raw = RawFolder {
        id: Some(f.id.clone()).filter(|i| !i.starts_with("path:")),
        name: Some(f.name.clone()),
        order: f.order,
        headers: kv_to_raw(&f.headers),
        auth: f.auth.clone(),
        extra: f.extra.clone().unwrap_or_default(),
    };
    let dir = root.join(&f.path);
    fs::create_dir_all(&dir)?;
    let text = serde_yaml::to_string(&raw).map_err(|e| OpenError::Serialize(e.to_string()))?;
    fs::write(dir.join("folder.yaml"), text)?;
    Ok(())
}

/// Set the inherited headers and auth in `collection.yaml`, keeping every other key (incl. unknown ones).
pub fn save_collection_defaults(root: &Path, headers: &[KeyValue], auth: Option<&Auth>) -> Result<(), OpenError> {
    writable(root)?;
    let path = root.join("collection.yaml");
    let old: Mapping = serde_yaml::from_str(&fs::read_to_string(&path)?)
        .map_err(|e| OpenError::InvalidManifest(e.to_string()))?;
    let ser = |e: serde_yaml::Error| OpenError::Serialize(e.to_string());
    // Canonical key order: formatVersion, name, headers, auth, then unknown keys in original order.
    let mut m = Mapping::new();
    for k in ["formatVersion", "name"] {
        if let Some(v) = old.get(k) {
            m.insert(k.into(), v.clone());
        }
    }
    if !headers.is_empty() {
        m.insert("headers".into(), serde_yaml::to_value(kv_to_raw(headers)).map_err(ser)?);
    }
    if let Some(a) = auth {
        m.insert("auth".into(), serde_yaml::to_value(a).map_err(ser)?);
    }
    for (k, v) in old {
        if !m.contains_key(&k) && !matches!(k.as_str(), Some("headers" | "auth")) {
            m.insert(k, v);
        }
    }
    fs::write(path, serde_yaml::to_string(&m).map_err(ser)?)?;
    Ok(())
}

/// Write an Environment file (canonical form). Secret values are never written (Secrets stay local).
/// Uses `env.path` when set, otherwise `environments/<slug>.yaml` with collision suffix. Returns the relative path.
pub fn save_environment(root: &Path, env: &EnvironmentItem) -> Result<String, OpenError> {
    writable(root)?;
    let raw = RawEnvironment {
        id: env.id.clone(),
        name: env.name.clone(),
        order: env.order,
        variables: env
            .variables
            .iter()
            .map(|v| RawEnvVar {
                id: v.id.clone(),
                key: v.key.clone(),
                value: if v.secret { None } else { Some(v.value.clone()) },
                secret: v.secret,
                extra: v.extra.clone().unwrap_or_default(),
            })
            .collect(),
        extra: env.extra.clone().unwrap_or_default(),
    };
    let dir = root.join("environments");
    fs::create_dir_all(&dir)?;
    let rel = if env.path.is_empty() {
        let base = slugify(&env.name);
        let mut n = 1;
        loop {
            let f = if n == 1 { format!("{base}.yaml") } else { format!("{base}-{n}.yaml") };
            if !dir.join(&f).exists() {
                break format!("environments/{f}");
            }
            n += 1;
        }
    } else {
        check_folder(&env.path)?;
        env.path.clone()
    };
    let text = serde_yaml::to_string(&raw).map_err(|e| OpenError::Serialize(e.to_string()))?;
    fs::write(root.join(&rel), text)?;
    Ok(rel)
}

/// Create a new Collection manifest at the current format version.
pub fn init_collection(root: &Path, name: &str) -> Result<(), OpenError> {
    fs::create_dir_all(root)?;
    let mut m = Mapping::new();
    m.insert("formatVersion".into(), serde_yaml::to_value(1.0f64).unwrap());
    m.insert("name".into(), name.into());
    let manifest = serde_yaml::to_string(&m).map_err(|e| OpenError::Serialize(e.to_string()))?;
    fs::write(root.join("collection.yaml"), manifest)?;
    Ok(())
}

/// Sparse decimal `order` for inserting between two neighbours (either may be absent).
pub fn order_between(prev: Option<f64>, next: Option<f64>) -> f64 {
    match (prev, next) {
        (None, None) => 1.0,
        (Some(p), None) => p.floor() + 1.0,
        (None, Some(n)) => n.ceil() - 1.0,
        (Some(p), Some(n)) => (p + n) / 2.0,
    }
}
