//! HTTP runner. Framework-independent (no Tauri); runs outside the webview so CORS never applies.

mod compose;
mod cookies;
mod run;
pub use compose::{compose, environment_vars, resolve, used_variables, ComposeError};
pub use cookies::{CookieJar, StoredCookie};
pub use run::{extract_captures, preview, run, PreviewVar, RequestPreview, RunError, RunOutcome, VarSource};

use std::time::Instant;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct Header {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<Header>,
    pub body: Option<String>,
    /// multipart/form-data parts; when set, `body` is ignored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub multipart: Option<Vec<FormPart>>,
    /// Path of a file sent as the raw body (binary); when set, `body` is ignored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub body_file: Option<String>,
}

/// One multipart/form-data field: text (`value`) or the content of a local file (`file`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct FormPart {
    pub name: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct HttpResponse {
    pub status: u16,
    pub time_ms: u32,
    pub size_bytes: u32,
    pub headers: Vec<Header>,
    pub body: String,
}

/// Per-machine transport settings (kept in the Local store, never in the repo).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct RunOptions {
    /// Accept invalid / self-signed TLS certificates.
    #[serde(default)]
    pub insecure_tls: bool,
    /// Proxy URL for all requests, e.g. `http://proxy.local:8080`.
    #[serde(default)]
    #[ts(optional)]
    pub proxy: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum SendError {
    #[error("invalid HTTP method: {0}")]
    InvalidMethod(String),
    #[error("invalid proxy: {0}")]
    InvalidProxy(String),
    #[error("invalid header \"{0}\": {1}")]
    InvalidHeader(String, String),
    #[error("cannot read file {0}: {1}")]
    File(String, String),
    /// Transport failure (connection refused, DNS, TLS, timeout...), described with its root cause.
    #[error("{0}")]
    Request(String),
}

impl From<reqwest::Error> for SendError {
    fn from(e: reqwest::Error) -> Self {
        SendError::Request(describe(&e))
    }
}

fn read_file(path: &str) -> Result<Vec<u8>, SendError> {
    std::fs::read(path).map_err(|e| SendError::File(path.to_string(), e.to_string()))
}

/// reqwest's own message ("error sending request for url (...)") hides the cause; name the cause.
fn describe(e: &reqwest::Error) -> String {
    let mut causes: Vec<String> = Vec::new();
    let mut src = std::error::Error::source(e);
    while let Some(s) = src {
        let m = s.to_string();
        if !causes.iter().any(|c| c.contains(&m)) {
            causes.push(m);
        }
        src = s.source();
    }
    let cause = causes.last().cloned().unwrap_or_else(|| e.to_string());
    let target = e
        .url()
        .map(|u| format!("{}:{}", u.host_str().unwrap_or(""), u.port_or_known_default().unwrap_or(0)))
        .unwrap_or_default();
    if e.is_timeout() {
        format!("Request to {target} timed out")
    } else if e.is_connect() {
        format!("Could not connect to {target}: {cause}")
    } else if e.is_builder() {
        format!("Invalid request: {cause}")
    } else {
        format!("{e}: {cause}")
    }
}

/// Send a request with default options and no cookies. Any HTTP status (including 4xx/5xx) is a
/// successful response; only transport-level failures are errors.
pub async fn send(request: HttpRequest) -> Result<HttpResponse, SendError> {
    send_with(request, &RunOptions::default(), &mut CookieJar::default()).await
}

/// Like [`send`], with TLS/proxy options and a cookie jar: matching cookies are attached and
/// `Set-Cookie` headers of the response are stored back into `jar`.
pub async fn send_with(
    request: HttpRequest,
    options: &RunOptions,
    jar: &mut CookieJar,
) -> Result<HttpResponse, SendError> {
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| SendError::InvalidMethod(request.method.clone()))?;
    let mut cb = reqwest::Client::builder().danger_accept_invalid_certs(options.insecure_tls);
    if let Some(p) = options.proxy.as_deref().filter(|p| !p.trim().is_empty()) {
        cb = cb.proxy(reqwest::Proxy::all(p.trim()).map_err(|e| SendError::InvalidProxy(e.to_string()))?);
    }
    let client = cb.build()?;
    let mut builder = client.request(method, &request.url);
    // Rows without a name (an empty row added in the editor) are not sent. A multipart body brings its
    // own Content-Type with the boundary, so a user-set one would break it.
    let multipart = request.multipart.is_some();
    for h in request
        .headers
        .iter()
        .filter(|h| !h.key.trim().is_empty())
        .filter(|h| !(multipart && h.key.trim().eq_ignore_ascii_case("content-type")))
    {
        let name = reqwest::header::HeaderName::from_bytes(h.key.trim().as_bytes())
            .map_err(|e| SendError::InvalidHeader(h.key.clone(), e.to_string()))?;
        let value = reqwest::header::HeaderValue::from_str(&h.value)
            .map_err(|e| SendError::InvalidHeader(h.key.clone(), e.to_string()))?;
        builder = builder.header(name, value);
    }
    let parsed_url = reqwest::Url::parse(&request.url).ok();
    if let Some(u) = &parsed_url {
        if !request.headers.iter().any(|h| h.key.eq_ignore_ascii_case("cookie")) {
            if let Some(c) = jar.header_for(u) {
                builder = builder.header("Cookie", c);
            }
        }
    }
    if let Some(parts) = request.multipart {
        let mut form = reqwest::multipart::Form::new();
        for p in parts {
            form = match p.file {
                Some(path) => {
                    let bytes = read_file(&path)?;
                    let file_name = std::path::Path::new(&path)
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_else(|| "file".into());
                    form.part(p.name, reqwest::multipart::Part::bytes(bytes).file_name(file_name))
                }
                None => form.text(p.name, p.value),
            };
        }
        builder = builder.multipart(form);
    } else if let Some(path) = request.body_file {
        let bytes = read_file(&path)?;
        if !request.headers.iter().any(|h| h.key.trim().eq_ignore_ascii_case("content-type")) {
            builder = builder.header(reqwest::header::CONTENT_TYPE, "application/octet-stream");
        }
        builder = builder.body(bytes);
    } else if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let started = Instant::now();
    let res = builder.send().await?;
    let status = res.status().as_u16();
    if let Some(u) = &parsed_url {
        let set: Vec<String> = res
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
            .collect();
        jar.store(u, set.iter().map(String::as_str));
    }
    let headers = res
        .headers()
        .iter()
        .map(|(k, v)| Header { key: k.to_string(), value: String::from_utf8_lossy(v.as_bytes()).into_owned() })
        .collect();
    let bytes = res.bytes().await?;
    let time_ms = started.elapsed().as_millis() as u32;

    Ok(HttpResponse {
        status,
        time_ms,
        size_bytes: bytes.len() as u32,
        headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}
