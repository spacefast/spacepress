//! The site side of sync: `/_schema` and `/sync/*` over HTTP (design §5.3), blocking.

use serde_json::{Value, json};
use std::time::Duration;

pub enum Credential {
    /// A standalone API token (`zero token create`).
    Token(String),
    /// A WordPress application password, `user:password`.
    AppPassword(String),
    /// An OIDC access token from the identity plugin.
    Bearer(String),
}

pub struct Client {
    agent: ureq::Agent,
    base: String,
    auth: String,
}

/// A failed call: HTTP status (0 when the site was unreachable) and the problem document.
#[derive(Debug)]
pub struct Problem {
    pub status: u16,
    pub body: Value,
}

impl Problem {
    pub fn code(&self) -> &str {
        self.body["code"].as_str().unwrap_or("")
    }

    /// The credential was refused (401) or lacks access (403): exit 4.
    pub fn is_auth(&self) -> bool {
        matches!(self.status, 401 | 403)
    }

    pub fn message(&self) -> String {
        match self.body["detail"].as_str() {
            Some(detail) => format!("{} ({})", detail, self.code()),
            None => format!("HTTP {}", self.status),
        }
    }
}

impl Client {
    /// `site` is the site's URL; the API prefix is found from it (`/api` standalone, `/wp-json/zero/v1`
    /// on WordPress) unless it already ends in one.
    pub fn new(site: &str, credential: Credential) -> Result<Client, String> {
        let url = url::Url::parse(site).map_err(|e| format!("--site: {e}"))?;
        if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() {
            return Err("--site must be an http(s) URL without credentials".into());
        }
        let auth = match credential {
            Credential::Token(t) | Credential::Bearer(t) => format!("Bearer {t}"),
            Credential::AppPassword(p) => format!("Basic {}", base64(p.as_bytes())),
        };
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(60)))
            .http_status_as_error(false)
            .max_redirects(0)
            .build()
            .into();
        let root = url.as_str().trim_end_matches('/').to_string();
        let mut client = Client {
            agent,
            base: root.clone(),
            auth,
        };
        if root.ends_with("/api") || root.ends_with("/wp-json/zero/v1") {
            return Ok(client);
        }
        for prefix in ["/wp-json/zero/v1", "/api"] {
            client.base = format!("{root}{prefix}");
            if client.get("/_schema").is_ok() {
                return Ok(client);
            }
        }
        client.base = format!("{root}/api");
        Ok(client)
    }

    pub fn get(&self, path: &str) -> Result<Value, Problem> {
        self.call("GET", path, None)
    }

    pub fn post(&self, path: &str, body: &Value) -> Result<Value, Problem> {
        self.call("POST", path, Some(body))
    }

    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<Value, Problem> {
        let url = format!("{}{path}", self.base);
        let response = match body {
            None => self.agent.get(&url).header("Authorization", &self.auth).call(),
            Some(body) => self
                .agent
                .post(&url)
                .header("Authorization", &self.auth)
                .header("Content-Type", "application/json")
                .send(body.to_string()),
        };
        let mut response = response.map_err(|e| Problem {
            status: 0,
            body: json!({"detail": format!("{method} {url}: {e}"), "code": "unreachable"}),
        })?;
        let status = response.status().as_u16();
        let invalid = |why: String| Problem {
            status,
            body: json!({"detail": format!("{method} {url} answered {status} {why}"), "code": "invalid_response"}),
        };
        let text = response
            .body_mut()
            .read_to_string()
            .map_err(|e| invalid(format!("with an unreadable body: {e}")))?;
        let parsed: Value = serde_json::from_str(&text).map_err(|_| invalid("without JSON".into()))?;
        if status >= 300 {
            return Err(Problem { status, body: parsed });
        }
        // A success is always `{ data }`; anything else is not a Zero site and must not read as "empty".
        match parsed.get("data") {
            Some(data) => Ok(data.clone()),
            None => Err(invalid("without a data envelope".into())),
        }
    }
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}
