//! Environment files passed between Members by hand (ticket #24): a Postman environment JSON or a
//! `.env` file in, a Postman environment JSON out. The export carries Secret values, which is the
//! point: they never travel through the repo.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::EnvironmentItem;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum EnvFileError {
    #[error("this is a Postman collection, not an environment: import it as a Collection")]
    Collection,
    #[error("not a Postman environment or .env file: {0}")]
    Invalid(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct EnvFileVar {
    pub key: String,
    pub value: String,
    pub secret: bool,
    pub enabled: bool,
}

/// What an environment file holds. `.env` has no id and no name.
#[derive(Debug, Clone, PartialEq)]
pub struct EnvFile {
    pub id: Option<String>,
    pub name: Option<String>,
    pub variables: Vec<EnvFileVar>,
}

/// Read a Postman environment (JSON) or a `.env` file.
pub fn parse_environment_file(text: &str) -> Result<EnvFile, EnvFileError> {
    let text = text.trim_start_matches('\u{feff}');
    if text.trim_start().starts_with('{') {
        parse_postman(text)
    } else {
        parse_dotenv(text)
    }
}

fn parse_postman(text: &str) -> Result<EnvFile, EnvFileError> {
    let root: Value = serde_json::from_str(text).map_err(|e| EnvFileError::Invalid(e.to_string()))?;
    if root.get("info").is_some() && root.get("item").is_some() {
        return Err(EnvFileError::Collection);
    }
    let values = root.get("values").and_then(Value::as_array).ok_or_else(|| EnvFileError::Invalid("missing values".into()))?;
    let str_of = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    let variables = values
        .iter()
        .filter_map(|v| {
            let key = str_of(v, "key")?;
            // Postman writes numbers and booleans as they are; Zenar values are text.
            let value = match v.get("value") {
                Some(Value::String(s)) => s.clone(),
                None | Some(Value::Null) => String::new(),
                Some(other) => other.to_string(),
            };
            Some(EnvFileVar {
                key,
                value,
                secret: v.get("type").and_then(Value::as_str) == Some("secret"),
                enabled: v.get("enabled").and_then(Value::as_bool).unwrap_or(true),
            })
        })
        .collect();
    Ok(EnvFile { id: str_of(&root, "id"), name: str_of(&root, "name"), variables })
}

fn parse_dotenv(text: &str) -> Result<EnvFile, EnvFileError> {
    let mut variables = Vec::new();
    for (n, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            return Err(EnvFileError::Invalid(format!("line {}: expected KEY=value", n + 1)));
        };
        let key = key.trim();
        if key.is_empty() || key.contains(char::is_whitespace) {
            return Err(EnvFileError::Invalid(format!("line {}: expected KEY=value", n + 1)));
        }
        variables.push(EnvFileVar { key: key.to_string(), value: dotenv_value(value.trim()), secret: false, enabled: true });
    }
    Ok(EnvFile { id: None, name: None, variables })
}

/// Quoted values keep everything between the quotes (`"` also understands `\n`, `\"`, `\\`);
/// unquoted ones end at ` #`.
fn dotenv_value(v: &str) -> String {
    let quoted = |q: char| v.len() >= 2 && v.starts_with(q) && v.ends_with(q);
    if quoted('\'') {
        return v[1..v.len() - 1].to_string();
    }
    if quoted('"') {
        let mut out = String::new();
        let mut chars = v[1..v.len() - 1].chars();
        while let Some(c) = chars.next() {
            if c != '\\' {
                out.push(c);
                continue;
            }
            match chars.next() {
                Some('n') => out.push('\n'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            }
        }
        return out;
    }
    v.split(" #").next().unwrap_or("").trim_end().to_string()
}

/// A Postman environment JSON for `env`. `secrets` maps variable id to this person's Secret value
/// (a Secret without one is exported empty).
pub fn export_postman_environment(env: &EnvironmentItem, secrets: &HashMap<String, String>) -> String {
    let values: Vec<Value> = env
        .variables
        .iter()
        .map(|v| {
            let value = if v.secret { secrets.get(&v.id).cloned().unwrap_or_default() } else { v.value.clone() };
            json!({ "key": v.key, "value": value, "type": if v.secret { "secret" } else { "default" }, "enabled": true })
        })
        .collect();
    let out = json!({
        "id": env.id,
        "name": env.name,
        "values": values,
        "_postman_variable_scope": "environment",
    });
    serde_json::to_string_pretty(&out).unwrap_or_default() + "\n"
}
