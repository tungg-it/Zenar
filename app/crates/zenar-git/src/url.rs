#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteUrl(String);

impl RemoteUrl {
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// Last path segment without a trailing `.git`.
    pub fn repo_name(&self) -> String {
        repo_name_of(&self.0)
    }
}

pub(crate) fn repo_name_of(remote: &str) -> String {
    let last = remote.trim_end_matches('/').rsplit(['/', ':']).next().unwrap_or("");
    last.strip_suffix(".git").unwrap_or(last).to_string()
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum UrlError {
    #[error("SSH URLs are not supported. Use the HTTPS link instead: {https_hint}")]
    Ssh { https_hint: String },
    #[error("Paste the HTTPS URL of the repo (starting with https://)")]
    NotHttps,
}

/// Accept only HTTPS URLs; reject SSH with the equivalent HTTPS link.
pub fn parse_remote_url(input: &str) -> Result<RemoteUrl, UrlError> {
    let s = input.trim();
    if let Some(rest) = s.strip_prefix("https://") {
        if !rest.is_empty() {
            return Ok(RemoteUrl(s.to_string()));
        }
        return Err(UrlError::NotHttps);
    }
    if let Some(rest) = s.strip_prefix("ssh://") {
        let rest = rest.rsplit_once('@').map(|(_, r)| r).unwrap_or(rest);
        let (host_port, path) = rest.split_once('/').unwrap_or((rest, ""));
        let host = host_port.split(':').next().unwrap_or("");
        return Err(UrlError::Ssh { https_hint: format!("https://{host}/{path}") });
    }
    // scp-like: user@host:path
    if !s.contains("://") {
        if let Some((left, path)) = s.split_once(':') {
            if let Some((_, host)) = left.split_once('@') {
                if !host.is_empty() && !host.contains('/') {
                    return Err(UrlError::Ssh {
                        https_hint: format!("https://{host}/{}", path.trim_start_matches('/')),
                    });
                }
            }
        }
    }
    Err(UrlError::NotHttps)
}
