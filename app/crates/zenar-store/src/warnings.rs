//! Warn (not block) on Save when a header or the body looks like a hard-coded token: it would be
//! shared with every Member. The fix is a Secret variable, referenced as `{{name}}`.

use serde::Serialize;
use ts_rs::TS;
use zenar_format::{Auth, CollectionData, KeyValue, RequestItem};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct TokenWarning {
    /// `header` or `body`.
    pub location: String,
    /// Header name; empty for the body.
    pub name: String,
    /// A disabled header: not sent, but still shared and exported.
    pub disabled: bool,
}

const SENSITIVE_HEADERS: &[&str] = &["authorization", "proxy-authorization", "x-api-key", "api-key", "x-auth-token", "x-access-token", "cookie"];
const PREFIXES: &[&str] = &["ghp_", "gho_", "github_pat_", "glpat-", "sk-", "xoxb-", "xoxp-", "AKIA"];

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')
}

/// A word that is a JWT or starts with a well-known token prefix (and is long enough to be real).
fn word_looks_like_token(w: &str) -> bool {
    let w = w.trim_matches(|c: char| !is_token_char(c));
    if w.starts_with("eyJ") && w.split('.').count() == 3 && w.len() >= 20 {
        return true;
    }
    w.len() >= 16 && PREFIXES.iter().any(|p| w.starts_with(p))
}

fn text_looks_like_token(text: &str) -> bool {
    text.split(|c: char| !is_token_char(c) && c != '{' && c != '}').any(|w| {
        // A `{{var}}` reference is exactly what we want; skip words containing braces.
        !w.contains('{') && word_looks_like_token(w)
    })
}

/// A literal (no `{{var}}`) credential in a sensitive header: at least 8 characters beyond a scheme word.
fn literal_credential(value: &str) -> bool {
    if value.contains("{{") {
        return false;
    }
    let secret = value.split_whitespace().last().unwrap_or("");
    secret.len() >= 8
}

pub fn token_warnings(request: &RequestItem) -> Vec<TokenWarning> {
    with_body(request, header_warnings(&request.headers, false))
}

fn with_body(request: &RequestItem, mut out: Vec<TokenWarning>) -> Vec<TokenWarning> {
    if request.body.as_deref().is_some_and(text_looks_like_token) {
        out.push(TokenWarning { location: "body".into(), name: String::new(), disabled: false });
    }
    out
}

/// `with_disabled`: also disabled headers (an export writes them too).
fn header_warnings(headers: &[KeyValue], with_disabled: bool) -> Vec<TokenWarning> {
    headers
        .iter()
        .filter(|h| h.enabled || with_disabled)
        .filter(|h| {
            let sensitive = SENSITIVE_HEADERS.contains(&h.key.to_ascii_lowercase().as_str());
            (sensitive && literal_credential(&h.value)) || text_looks_like_token(&h.value)
        })
        .map(|h| TokenWarning { location: "header".into(), name: h.key.clone(), disabled: !h.enabled })
        .collect()
}

/// A Bearer token, Basic password or API key value written out instead of a `{{variable}}`.
fn auth_warning(auth: Option<&Auth>) -> Option<TokenWarning> {
    let a = auth?;
    let secret = match a.kind.as_str() {
        "bearer" => &a.token,
        "basic" => &a.password,
        "apikey" => &a.value,
        _ => return None,
    };
    secret
        .as_deref()
        .filter(|s| literal_credential(s))
        .map(|_| TokenWarning { location: "auth".into(), name: a.kind.clone(), disabled: false })
}

/// Where hard-coded credentials sit in a Collection, before it leaves the app (export).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct PlacedTokenWarning {
    /// `collection`, `folder` or `request`.
    pub kind: String,
    /// Request or Folder id; empty for the Collection.
    pub id: String,
    /// Folder names down to the item, `/`-separated ("PAYING / refund"); the Collection's name for it.
    pub place: String,
    pub warnings: Vec<TokenWarning>,
}

/// Every Request (headers, body, auth), Folder and the Collection itself (headers and auth they pass on).
/// Disabled headers count: the export writes them.
pub fn collection_token_warnings(data: &CollectionData) -> Vec<PlacedTokenWarning> {
    let folder_name = |path: &str| -> String {
        data.folders.iter().find(|f| f.path == path).map_or_else(|| path.rsplit('/').next().unwrap_or(path).to_string(), |f| f.name.clone())
    };
    let place = |folder: &str, name: &str| {
        let mut parts: Vec<String> = Vec::new();
        let mut at = String::new();
        for seg in folder.split('/').filter(|s| !s.is_empty()) {
            at = if at.is_empty() { seg.to_string() } else { format!("{at}/{seg}") };
            parts.push(folder_name(&at));
        }
        parts.push(name.to_string());
        parts.join(" / ")
    };
    let mut out = Vec::new();
    let mut push = |kind: &str, id: &str, place: String, mut warnings: Vec<TokenWarning>, auth: Option<&Auth>| {
        warnings.extend(auth_warning(auth));
        if !warnings.is_empty() {
            out.push(PlacedTokenWarning { kind: kind.into(), id: id.into(), place, warnings });
        }
    };
    push("collection", "", data.name.clone(), header_warnings(&data.headers, true), data.auth.as_ref());
    for f in &data.folders {
        let parent = f.path.rsplit_once('/').map_or("", |(p, _)| p);
        push("folder", &f.id, place(parent, &f.name), header_warnings(&f.headers, true), f.auth.as_ref());
    }
    for r in &data.requests {
        push("request", &r.id, place(&r.folder, &r.name), with_body(r, header_warnings(&r.headers, true)), r.auth.as_ref());
    }
    out
}
