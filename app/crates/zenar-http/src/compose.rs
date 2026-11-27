//! Request composition: turn a saved Request plus its Folder/Collection defaults and a variable
//! map into the concrete `HttpRequest` to send. Pure logic, no I/O, no Tauri.
//!
//! Rules:
//! - Headers and Auth inherit Collection -> Folders (outermost first) -> Request; nearer wins.
//! - Headers match by case-insensitive name. A disabled header at any level removes an inherited one.
//! - Auth: nearest level that sets it wins; `type: none` stops inheritance. Auth produces a header
//!   (or query param for API keys) that an explicit header of the same name overrides.
//! - `{{name}}` is replaced in URL, params, path variables, headers, auth and body. An unknown name is an error.
//! - A URL path segment `:name` takes the value of the Path Variable `name` (before `{{name}}` is
//!   replaced); one with no Path Variable is sent as written.

use std::collections::HashMap;

use base64::Engine;
use zenar_format::{Auth, CollectionData, EnvironmentItem, FolderItem, KeyValue, RequestItem};

use crate::{Header, HttpRequest};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ComposeError {
    #[error("variable {{{{{0}}}}} has no value")]
    UnresolvedVariable(String),
    #[error("invalid URL: {0}")]
    InvalidUrl(String),
    #[error("GraphQL variables are not valid JSON: {0}")]
    InvalidGraphqlVariables(String),
}

/// Variables of an Environment (Secret values are whatever the caller has filled in locally).
pub fn environment_vars(env: &EnvironmentItem) -> HashMap<String, String> {
    env.variables.iter().map(|v| (v.key.clone(), v.value.clone())).collect()
}

/// Replace every `{{name}}` (surrounding spaces allowed) using `vars`.
pub fn resolve(text: &str, vars: &HashMap<String, String>) -> Result<String, ComposeError> {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        let Some(len) = rest[start + 2..].find("}}") else { break };
        let name = rest[start + 2..start + 2 + len].trim();
        out.push_str(&rest[..start]);
        match vars.get(name) {
            Some(v) => out.push_str(v),
            None => return Err(ComposeError::UnresolvedVariable(name.to_string())),
        }
        rest = &rest[start + 2 + len + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Names of the `{{name}}` references in `text`, in order (repeats included).
fn variable_refs(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        let Some(len) = rest[start + 2..].find("}}") else { break };
        out.push(rest[start + 2..start + 2 + len].trim().to_string());
        rest = &rest[start + 2 + len + 2..];
    }
    out
}

/// Every variable `request` refers to, including through inherited Folder / Collection headers and
/// auth: first-use order, no repeats.
pub fn used_variables(collection: &CollectionData, request: &RequestItem) -> Vec<String> {
    let folders = folder_chain(collection, &request.folder);
    let mut texts = vec![serde_json::to_string(request).unwrap_or_default()];
    texts.push(serde_json::to_string(&(&collection.headers, &collection.auth)).unwrap_or_default());
    texts.extend(folders.iter().map(|f| serde_json::to_string(&(&f.headers, &f.auth)).unwrap_or_default()));
    let mut out: Vec<String> = Vec::new();
    for name in texts.iter().flat_map(|t| variable_refs(t)) {
        if !name.is_empty() && !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

/// Whether a URL path segment is a Path Variable (`:name`), and its name.
fn path_variable_name(segment: &str) -> Option<&str> {
    let name = segment.strip_prefix(':')?;
    let ok = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    ok.then_some(name)
}

/// Replace each `:name` path segment of `url` with the value of the Path Variable `name`.
fn fill_path_variables(url: &str, vars: &[KeyValue]) -> String {
    if vars.is_empty() {
        return url.to_string();
    }
    let end = url.find(['?', '#']).unwrap_or(url.len());
    let (path, rest) = url.split_at(end);
    let path = path
        .split('/')
        .map(|seg| {
            path_variable_name(seg)
                .and_then(|name| vars.iter().find(|v| v.key == name))
                .map_or(seg, |v| v.value.as_str())
        })
        .collect::<Vec<_>>()
        .join("/");
    path + rest
}

fn merge_headers(layers: &[&[KeyValue]], base: Vec<(String, String)>) -> Vec<(String, String)> {
    let mut out = base;
    for layer in layers {
        for h in layer.iter().filter(|h| !h.key.trim().is_empty()) {
            let pos = out.iter().position(|(k, _)| k.eq_ignore_ascii_case(&h.key));
            match (h.enabled, pos) {
                (true, Some(i)) => out[i] = (h.key.clone(), h.value.clone()),
                (true, None) => out.push((h.key.clone(), h.value.clone())),
                (false, Some(i)) => {
                    out.remove(i);
                }
                (false, None) => {}
            }
        }
    }
    out
}

fn folder_chain<'a>(c: &'a CollectionData, folder: &str) -> Vec<&'a FolderItem> {
    let mut chain = Vec::new();
    let mut path = String::new();
    for seg in folder.split('/').filter(|s| !s.is_empty()) {
        if !path.is_empty() {
            path.push('/');
        }
        path.push_str(seg);
        if let Some(f) = c.folders.iter().find(|f| f.path == path) {
            chain.push(f);
        }
    }
    chain
}

enum AuthOut {
    Header(String, String),
    Query(String, String),
}

fn auth_output(auth: &Auth, vars: &HashMap<String, String>) -> Result<Option<AuthOut>, ComposeError> {
    let get = |v: &Option<String>| resolve(v.as_deref().unwrap_or(""), vars);
    Ok(match auth.kind.as_str() {
        "bearer" => Some(AuthOut::Header("Authorization".into(), format!("Bearer {}", get(&auth.token)?))),
        "basic" => {
            let raw = format!("{}:{}", get(&auth.username)?, get(&auth.password)?);
            let enc = base64::engine::general_purpose::STANDARD.encode(raw);
            Some(AuthOut::Header("Authorization".into(), format!("Basic {enc}")))
        }
        "apikey" => {
            let (k, v) = (get(&auth.key)?, get(&auth.value)?);
            if auth.location.as_deref() == Some("query") {
                Some(AuthOut::Query(k, v))
            } else {
                Some(AuthOut::Header(k, v))
            }
        }
        _ => None,
    })
}

fn form_body(content: &str, vars: &HashMap<String, String>) -> Result<String, ComposeError> {
    let mut pairs = Vec::new();
    for line in content.lines().filter(|l| !l.trim().is_empty()) {
        let (k, v) = line.split_once('=').unwrap_or((line, ""));
        pairs.push((resolve(k, vars)?, resolve(v, vars)?));
    }
    let mut u = reqwest::Url::parse("http://x").expect("static url");
    u.query_pairs_mut().extend_pairs(pairs);
    Ok(u.query().unwrap_or("").to_string())
}

/// Build the concrete request for `request`, inheriting from its Folders and the Collection.
pub fn compose(
    collection: &CollectionData,
    request: &RequestItem,
    vars: &HashMap<String, String>,
) -> Result<HttpRequest, ComposeError> {
    let folders = folder_chain(collection, &request.folder);

    // Auth: nearest level that sets it.
    let auth = request
        .auth
        .as_ref()
        .or_else(|| folders.iter().rev().find_map(|f| f.auth.as_ref()))
        .or(collection.auth.as_ref());
    let auth_out = match auth {
        Some(a) => auth_output(a, vars)?,
        None => None,
    };

    // Headers: auth is the lowest layer, then Collection, Folders, Request.
    let mut base = Vec::new();
    let mut query: Vec<(String, String)> = Vec::new();
    match auth_out {
        Some(AuthOut::Header(k, v)) => base.push((k, v)),
        Some(AuthOut::Query(k, v)) => query.push((k, v)),
        None => {}
    }
    let mut layers: Vec<&[KeyValue]> = vec![&collection.headers];
    layers.extend(folders.iter().map(|f| f.headers.as_slice()));
    layers.push(&request.headers);
    let merged = merge_headers(&layers, base);
    let mut headers = merged
        .into_iter()
        .map(|(key, value)| Ok(Header { key: resolve(&key, vars)?, value: resolve(&value, vars)? }))
        .collect::<Result<Vec<_>, ComposeError>>()?;

    // URL + params.
    let mut url = resolve(&fill_path_variables(&request.url, &request.path_variables), vars)?;
    for p in request.params.iter().filter(|p| p.enabled && !p.key.trim().is_empty()) {
        query.push((resolve(&p.key, vars)?, resolve(&p.value, vars)?));
    }
    if !query.is_empty() {
        let mut u = reqwest::Url::parse(&url).map_err(|e| ComposeError::InvalidUrl(e.to_string()))?;
        u.query_pairs_mut().extend_pairs(query);
        url = u.to_string();
    }

    // Body.
    let mut content_type = None;
    let mut multipart = None;
    let mut body_file = None;
    let body = match request.body_type.as_deref() {
        Some("formdata") => {
            let parts = request
                .form_fields()
                .into_iter()
                .filter(|f| f.enabled && !f.key.trim().is_empty())
                .map(|f| {
                    let name = resolve(&f.key, vars)?;
                    let value = resolve(&f.value, vars)?;
                    Ok(if f.kind == "file" {
                        crate::FormPart { name, value: String::new(), file: Some(value) }
                    } else {
                        crate::FormPart { name, value, file: None }
                    })
                })
                .collect::<Result<Vec<_>, ComposeError>>()?;
            multipart = Some(parts);
            None
        }
        Some("binary") => {
            body_file = request.body_file().map(|p| resolve(&p, vars)).transpose()?;
            None
        }
        Some("graphql") => {
            content_type = Some("application/json");
            let mut o = serde_json::Map::new();
            o.insert("query".into(), serde_json::Value::String(resolve(request.body.as_deref().unwrap_or(""), vars)?));
            if let Some(v) = request.graphql_variables() {
                let v = resolve(&v, vars)?;
                let parsed: serde_json::Value =
                    serde_json::from_str(&v).map_err(|e| ComposeError::InvalidGraphqlVariables(e.to_string()))?;
                o.insert("variables".into(), parsed);
            }
            Some(serde_json::Value::Object(o).to_string())
        }
        _ => raw_body(request, vars, &mut content_type)?,
    };
    if let Some(ct) = content_type {
        if !headers.iter().any(|h| h.key.eq_ignore_ascii_case("content-type")) {
            headers.push(Header { key: "Content-Type".into(), value: ct.into() });
        }
    }

    Ok(HttpRequest { method: request.method.clone(), url, headers, body, multipart, body_file })
}

/// Text bodies: x-www-form-urlencoded (`form`) and raw languages.
fn raw_body(
    request: &RequestItem,
    vars: &HashMap<String, String>,
    content_type: &mut Option<&'static str>,
) -> Result<Option<String>, ComposeError> {
    Ok(match request.body.as_deref() {
        None => None,
        Some(content) => match request.body_type.as_deref() {
            Some("form") => {
                *content_type = Some("application/x-www-form-urlencoded");
                Some(form_body(content, vars)?)
            }
            kind => {
                // Raw body languages (Postman's raw picker); "raw" or anything unknown sets no Content-Type.
                *content_type = match kind {
                    Some("json") => Some("application/json"),
                    Some("text") => Some("text/plain"),
                    Some("javascript") => Some("application/javascript"),
                    Some("html") => Some("text/html"),
                    Some("xml") => Some("application/xml"),
                    _ => None,
                };
                Some(resolve(content, vars)?)
            }
        },
    })
}
