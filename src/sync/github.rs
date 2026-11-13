//! The few GitHub REST calls `first sync --pr` makes: find the open sync pull request, open one,
//! update its description and comment on it. Blocking, through the same HTTP agent as the site client.
//! The token is `GITHUB_TOKEN`; the API's URL is `GITHUB_API_URL` (set by GitHub Actions, and by
//! GitHub Enterprise), otherwise `https://api.github.com`.

use serde_json::{Value, json};
use std::time::Duration;

pub struct GitHub {
    agent: ureq::Agent,
    api: String,
    repo: String,
    auth: String,
}

/// An open pull request the sync owns.
#[derive(Clone, Debug)]
pub struct Pull {
    pub number: u64,
    pub url: String,
    pub head: String,
}

impl GitHub {
    /// `repo` is `owner/name`.
    pub fn new(api: &str, repo: &str, token: &str) -> Result<GitHub, String> {
        let parsed = url::Url::parse(api).map_err(|e| format!("GITHUB_API_URL: {e}"))?;
        if !matches!(parsed.scheme(), "http" | "https") || !parsed.username().is_empty() {
            return Err("GITHUB_API_URL must be an http(s) URL without credentials".into());
        }
        let mut parts = repo.split('/');
        let valid = |s: Option<&str>| {
            s.is_some_and(|s| {
                !s.is_empty()
                    && s != "."
                    && s != ".."
                    && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
            })
        };
        if !valid(parts.next()) || !valid(parts.next()) || parts.next().is_some() {
            return Err(format!("{repo:?} is not a GitHub repository; expected owner/name"));
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(60)))
            .http_status_as_error(false)
            .max_redirects(0)
            .build()
            .into();
        Ok(GitHub {
            agent,
            api: api.trim_end_matches('/').to_string(),
            repo: repo.to_string(),
            auth: format!("Bearer {token}"),
        })
    }

    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<Value, String> {
        let url = format!("{}/repos/{}{path}", self.api, self.repo);
        let headers = [
            ("Authorization", self.auth.as_str()),
            ("Accept", "application/vnd.github+json"),
            ("X-GitHub-Api-Version", "2022-11-28"),
            ("User-Agent", "first-sync"),
        ];
        let response = match (method, body) {
            ("GET", _) => headers
                .iter()
                .fold(self.agent.get(&url), |r, (k, v)| r.header(*k, *v))
                .call(),
            (_, Some(b)) => headers
                .iter()
                .fold(
                    if method == "PATCH" {
                        self.agent.patch(&url)
                    } else {
                        self.agent.post(&url)
                    },
                    |r, (k, v)| r.header(*k, *v),
                )
                .header("Content-Type", "application/json")
                .send(b.to_string()),
            _ => unreachable!("a GitHub call is a GET, or a POST or PATCH with a body"),
        };
        let mut response = response.map_err(|e| format!("GitHub {method} {path}: {e}"))?;
        let status = response.status().as_u16();
        let text = response.body_mut().read_to_string().unwrap_or_default();
        let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if !(200..300).contains(&status) {
            let detail = parsed["message"].as_str().unwrap_or("no message");
            let hint = match status {
                401 => " (GITHUB_TOKEN was refused)",
                403 | 404 => " (the token needs contents: write and pull-requests: write on this repository)",
                _ => "",
            };
            return Err(format!("GitHub {method} {path} answered {status}: {detail}{hint}"));
        }
        Ok(parsed)
    }

    /// The repository's default branch.
    pub fn default_branch(&self) -> Result<String, String> {
        let repo = self.call("GET", "", None)?;
        repo["default_branch"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| "GitHub's answer for the repository has no default_branch".into())
    }

    /// The open pull request into `base` whose branch starts with `prefix`, from this repository.
    pub fn open_pull(&self, base: &str, prefix: &str) -> Result<Option<Pull>, String> {
        let base_q: String = url::form_urlencoded::byte_serialize(base.as_bytes()).collect();
        for page in 1..=10 {
            let list = self.call(
                "GET",
                &format!("/pulls?state=open&base={base_q}&per_page=100&page={page}"),
                None,
            )?;
            let list = list.as_array().ok_or("GitHub's pull request list is not a list")?;
            for pr in list {
                let head = pr["head"]["ref"].as_str().unwrap_or_default();
                let same_repo = pr["head"]["repo"]["full_name"].as_str() == Some(self.repo.as_str());
                if same_repo && head.starts_with(prefix) {
                    return Ok(Some(Pull {
                        number: pr["number"].as_u64().ok_or("a pull request without a number")?,
                        url: pr["html_url"].as_str().unwrap_or_default().to_string(),
                        head: head.to_string(),
                    }));
                }
            }
            if list.len() < 100 {
                break;
            }
        }
        Ok(None)
    }

    pub fn create_pull(&self, head: &str, base: &str, title: &str, body: &str) -> Result<Pull, String> {
        let pr = self.call(
            "POST",
            "/pulls",
            Some(&json!({"head": head, "base": base, "title": title, "body": body, "maintainer_can_modify": true})),
        )?;
        Ok(Pull {
            number: pr["number"].as_u64().ok_or("GitHub's new pull request has no number")?,
            url: pr["html_url"].as_str().unwrap_or_default().to_string(),
            head: head.to_string(),
        })
    }

    pub fn update_pull(&self, number: u64, body: &str) -> Result<(), String> {
        self.call("PATCH", &format!("/pulls/{number}"), Some(&json!({"body": body})))
            .map(|_| ())
    }

    pub fn close_pull(&self, number: u64) -> Result<(), String> {
        self.call("PATCH", &format!("/pulls/{number}"), Some(&json!({"state": "closed"})))
            .map(|_| ())
    }

    pub fn comment(&self, number: u64, body: &str) -> Result<(), String> {
        self.call(
            "POST",
            &format!("/issues/{number}/comments"),
            Some(&json!({"body": body})),
        )
        .map(|_| ())
    }
}

/// `owner/name` from a GitHub remote URL (`https://github.com/o/n.git`, `git@github.com:o/n.git`,
/// `ssh://git@github.com/o/n`), None for anything else.
pub fn repo_from_remote(remote: &str) -> Option<String> {
    let rest = remote
        .strip_prefix("git@github.com:")
        .or_else(|| remote.split_once("github.com/").map(|(_, r)| r))?;
    let rest = rest.trim_end_matches('/').trim_end_matches(".git");
    let mut parts = rest.split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    (parts.next().is_none() && !owner.is_empty() && !name.is_empty()).then(|| format!("{owner}/{name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_remote_names_its_repository_only_when_it_is_on_github() {
        for remote in [
            "https://github.com/acme/site.git",
            "https://github.com/acme/site",
            "git@github.com:acme/site.git",
            "ssh://git@github.com/acme/site",
            "https://x-access-token:t@github.com/acme/site.git",
        ] {
            assert_eq!(repo_from_remote(remote).as_deref(), Some("acme/site"), "{remote}");
        }
        for remote in [
            "/srv/git/site.git",
            "https://gitlab.com/acme/site.git",
            "https://github.com/acme",
        ] {
            assert_eq!(repo_from_remote(remote), None, "{remote}");
        }
    }

    #[test]
    fn a_repository_must_be_owner_slash_name() {
        for repo in ["acme", "acme/site/x", "../site", "acme/..", "acme/si te"] {
            assert!(GitHub::new("https://api.github.com", repo, "t").is_err(), "{repo}");
        }
        assert!(GitHub::new("https://api.github.com", "acme/site.docs", "t").is_ok());
    }
}
