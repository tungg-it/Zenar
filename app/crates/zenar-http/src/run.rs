//! Running a saved Request: compose with Captured Variables, send with the Collection's cookie jar,
//! then extract new Captured Variables from the response. No I/O besides the HTTP call; persisting
//! captured values, cookies and history is the caller's job (the Local store).

use std::collections::HashMap;

use serde::Serialize;
use ts_rs::TS;
use zenar_format::{Capture, CollectionData, RequestItem};

use crate::{compose, used_variables, ComposeError, CookieJar, HttpRequest, HttpResponse, RunOptions, SendError};

#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error(transparent)]
    Compose(#[from] ComposeError),
    #[error(transparent)]
    Send(#[from] SendError),
}

#[derive(Debug, Clone)]
pub struct RunOutcome {
    /// The request as actually sent (variables resolved).
    pub sent: crate::HttpRequest,
    pub response: HttpResponse,
    /// `(name, value)` pairs captured from this response, in rule order.
    pub captured: Vec<(String, String)>,
}

/// Evaluate each rule's JSONPath against a JSON `body`. Strings come out raw, other values as JSON
/// text. A rule that does not match (or an invalid path / non-JSON body) captures nothing.
pub fn extract_captures(body: &str, captures: &[Capture]) -> Vec<(String, String)> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else { return vec![] };
    captures
        .iter()
        .filter_map(|c| {
            let path = serde_json_path::JsonPath::parse(&c.path).ok()?;
            let value = match path.query(&json).first()? {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            Some((c.name.clone(), value))
        })
        .collect()
}

/// `env_vars` are the Environment's variables; `captured` (Captured Variables) override them.
pub async fn run(
    collection: &CollectionData,
    request: &RequestItem,
    env_vars: &HashMap<String, String>,
    captured: &HashMap<String, String>,
    options: &RunOptions,
    jar: &mut CookieJar,
) -> Result<RunOutcome, RunError> {
    let mut vars = env_vars.clone();
    vars.extend(captured.iter().map(|(k, v)| (k.clone(), v.clone())));
    let sent = compose(collection, request, &vars)?;
    let response = crate::send_with(sent.clone(), options, jar).await?;
    let captured = extract_captures(&response.body, &request.captures);
    Ok(RunOutcome { sent, response, captured })
}

/// Where a variable's value comes from.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../../src/bindings/")]
pub enum VarSource {
    Environment,
    Captured,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct PreviewVar {
    pub name: String,
    pub value: String,
    pub source: VarSource,
}

/// What Send would do, without sending: the composed request (or why it cannot be composed) and
/// the variables it uses.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../../src/bindings/")]
pub struct RequestPreview {
    pub request: Option<HttpRequest>,
    pub error: Option<String>,
    /// Variables the Request refers to (inherited headers / auth included), in first-use order.
    pub used: Vec<String>,
    /// Every variable available, by name; a Captured Variable hides an Environment one.
    pub variables: Vec<PreviewVar>,
}

/// Compose `request` the way [`run`] does, without sending it.
pub fn preview(
    collection: &CollectionData,
    request: &RequestItem,
    env_vars: &HashMap<String, String>,
    captured: &HashMap<String, String>,
) -> RequestPreview {
    let mut vars = env_vars.clone();
    vars.extend(captured.iter().map(|(k, v)| (k.clone(), v.clone())));
    let (request_out, error) = match compose(collection, request, &vars) {
        Ok(r) => (Some(r), None),
        Err(e) => (None, Some(e.to_string())),
    };
    let mut variables: Vec<PreviewVar> = vars
        .into_iter()
        .map(|(name, value)| {
            let source = if captured.contains_key(&name) { VarSource::Captured } else { VarSource::Environment };
            PreviewVar { name, value, source }
        })
        .collect();
    variables.sort_by(|a, b| a.name.cmp(&b.name));
    RequestPreview { request: request_out, error, used: used_variables(collection, request), variables }
}
