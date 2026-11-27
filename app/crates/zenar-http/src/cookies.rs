//! A small serializable cookie jar. One jar per Collection; the Local store persists it as JSON.
//! Limits: Set-Cookie on intermediate redirect hops is not seen (reqwest follows redirects itself);
//! `Expires` is ignored, only `Max-Age` ends a cookie early.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    /// True when no `Domain` attribute was given: only the exact host matches.
    pub host_only: bool,
    pub path: String,
    pub secure: bool,
    /// Unix seconds; `None` for a session cookie.
    pub expires_at: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CookieJar {
    pub cookies: Vec<StoredCookie>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn default_path(url_path: &str) -> String {
    match url_path.rfind('/') {
        Some(0) | None => "/".into(),
        Some(i) => url_path[..i].to_string(),
    }
}

fn path_matches(request_path: &str, cookie_path: &str) -> bool {
    request_path == cookie_path
        || (request_path.starts_with(cookie_path)
            && (cookie_path.ends_with('/') || request_path[cookie_path.len()..].starts_with('/')))
}

impl CookieJar {
    /// `Cookie` header value for a request to `url`, if any cookie applies.
    pub fn header_for(&self, url: &reqwest::Url) -> Option<String> {
        let host = url.host_str()?;
        let https = url.scheme() == "https";
        let t = now();
        let pairs: Vec<String> = self
            .cookies
            .iter()
            .filter(|c| c.expires_at.map_or(true, |e| e > t))
            .filter(|c| !c.secure || https)
            .filter(|c| {
                host == c.domain || (!c.host_only && host.ends_with(&format!(".{}", c.domain)))
            })
            .filter(|c| path_matches(url.path(), &c.path))
            .map(|c| format!("{}={}", c.name, c.value))
            .collect();
        if pairs.is_empty() { None } else { Some(pairs.join("; ")) }
    }

    /// Apply the `Set-Cookie` header values of a response from `url`.
    pub fn store<'a>(&mut self, url: &reqwest::Url, set_cookies: impl IntoIterator<Item = &'a str>) {
        let Some(host) = url.host_str() else { return };
        for raw in set_cookies {
            let mut parts = raw.split(';');
            let Some((name, value)) = parts.next().and_then(|nv| nv.split_once('=')) else { continue };
            let (name, value) = (name.trim().to_string(), value.trim().to_string());
            if name.is_empty() {
                continue;
            }
            let mut c = StoredCookie {
                name,
                value,
                domain: host.to_string(),
                host_only: true,
                path: default_path(url.path()),
                secure: false,
                expires_at: None,
            };
            let mut delete = false;
            for attr in parts {
                let (k, v) = attr.split_once('=').map(|(k, v)| (k.trim(), v.trim())).unwrap_or((attr.trim(), ""));
                match k.to_ascii_lowercase().as_str() {
                    "domain" if !v.is_empty() => {
                        c.domain = v.trim_start_matches('.').to_ascii_lowercase();
                        c.host_only = false;
                    }
                    "path" if v.starts_with('/') => c.path = v.to_string(),
                    "secure" => c.secure = true,
                    "max-age" => match v.parse::<i64>() {
                        Ok(n) if n <= 0 => delete = true,
                        Ok(n) => c.expires_at = Some(now() + n as u64),
                        Err(_) => {}
                    },
                    _ => {}
                }
            }
            // Reject a Domain attribute that does not cover the responding host.
            if !c.host_only && host != c.domain && !host.ends_with(&format!(".{}", c.domain)) {
                continue;
            }
            self.cookies.retain(|o| !(o.name == c.name && o.domain == c.domain && o.path == c.path));
            if !delete {
                self.cookies.push(c);
            }
        }
    }
}
