//! `first doctor --links`: every link and `#anchor` a site's own pages make, followed.
//!
//! A First site's pages come from content (synced Markdown, edited in wp-admin), TSX and WordPress
//! itself, so a broken link can come from any of them and only shows on the served site. The check
//! reads the site as a visitor does. It starts at the home page, the sitemap's pages and the pages
//! `/llms.txt` lists, then follows every link, image, stylesheet and script on the same site,
//! breadth first. It reports each one that doesn't answer 2xx, and each `#fragment` the target page
//! has no element with that id or name for. Links to other sites are not fetched.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::time::Duration;
use url::Url;

/// Pages read per run: a site larger than this is reported as truncated, not checked further.
const LIMIT: usize = 5000;

/// One broken link: the page it is on, the URL as written there, and what is wrong.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Broken {
    pub on: String,
    pub href: String,
    pub problem: String,
}

pub struct Report {
    pub pages: usize,
    pub broken: Vec<Broken>,
    pub truncated: bool,
}

struct Fetched {
    status: u16,
    html: Option<String>,
    /// Where a redirect led, when it did.
    location: Option<Url>,
}

/// How a URL is read: over HTTP for a site, and a stub in tests.
pub trait Fetch {
    /// The status, the body of an HTML, XML or plain-text answer, and a redirect's `Location`.
    fn get(&self, url: &Url) -> Result<(u16, Option<String>, Option<String>), String>;
}

/// The site over HTTP. Redirects are followed one hop at a time so each hop stays on the site.
pub struct Http(ureq::Agent);

impl Http {
    pub fn new() -> Self {
        Http(
            ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(30)))
                .max_redirects(0)
                .http_status_as_error(false)
                .build()
                .into(),
        )
    }
}

impl Fetch for Http {
    fn get(&self, url: &Url) -> Result<(u16, Option<String>, Option<String>), String> {
        let mut response = self.0.get(url.as_str()).call().map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
        };
        let location = header("location");
        // Pages to read links from, and the sitemap and llms.txt the crawl starts from.
        let text = header("content-type")
            .is_some_and(|t| t.contains("text/html") || t.contains("xml") || t.contains("text/plain"))
            && status < 300;
        let body = if text {
            Some(
                response
                    .body_mut()
                    .with_config()
                    .limit(16 * 1024 * 1024)
                    .read_to_string()
                    .map_err(|e| e.to_string())?,
            )
        } else {
            None
        };
        Ok((status, body, location))
    }
}

/// The site's own URLs to start from: the home page, the sitemap's pages and `/llms.txt`'s.
fn seeds(site: &Url, fetch: &dyn Fetch) -> Vec<Url> {
    let mut out = vec![site.clone()];
    for (path, pattern) in [
        ("wp-sitemap.xml", r"<loc>([^<]+)</loc>"),
        ("sitemap.xml", r"<loc>([^<]+)</loc>"),
        ("llms.txt", r"\]\((https?://[^)\s]+)\)"),
    ] {
        let Ok(url) = site.join(path) else { continue };
        let re = regex::Regex::new(pattern).expect("seed pattern");
        let mut queue = vec![url];
        let mut seen = BTreeSet::new();
        while let Some(url) = queue.pop() {
            if !seen.insert(url.to_string()) || seen.len() > 200 {
                continue;
            }
            let Ok((200, Some(body), _)) = fetch.get(&url) else {
                continue;
            };
            for m in re.captures_iter(&body) {
                let Ok(found) = Url::parse(&m[1]) else { continue };
                if !same_site(site, &found) {
                    continue;
                }
                // A sitemap index lists more sitemaps.
                if found.path().ends_with(".xml") {
                    queue.push(found);
                } else {
                    out.push(found);
                }
            }
        }
    }
    out
}

/// A page's identity for reading it once: `/docs/x` and `/docs/x/` are one page.
fn page_key(url: &Url) -> String {
    let mut url = url.clone();
    if url.path().len() > 1 && url.path().ends_with('/') {
        let path = url.path().trim_end_matches('/').to_string();
        url.set_path(&path);
    }
    url.to_string()
}

fn same_site(site: &Url, url: &Url) -> bool {
    url.scheme() == site.scheme()
        && url.host_str() == site.host_str()
        && url.port_or_known_default() == site.port_or_known_default()
        && url.path().starts_with(site.path().trim_end_matches('/'))
}

/// What WordPress serves for itself, not the site's pages: never followed.
fn wordpress_own(site: &Url, url: &Url) -> bool {
    let path = &url.path()[site.path().trim_end_matches('/').len()..];
    [
        "/wp-admin",
        "/wp-login.php",
        "/wp-json",
        "/xmlrpc.php",
        "/wp-cron.php",
        "/feed",
        "/comments/feed",
        "/__first/",
        "/__spacefast/",
    ]
    .iter()
    .any(|p| path == *p || path.starts_with(&format!("{}/", p.trim_end_matches('/'))) || path.starts_with(p))
        || url
            .query()
            .is_some_and(|q| q.contains("replytocom=") || q.contains("rest_route="))
}

/// The links an HTML page makes: `(attribute value, followed as a page)`. Pages are `<a href>`;
/// assets are `src`, `<link href>` and `srcset` candidates.
fn links(html: &str) -> Vec<(String, bool)> {
    let tag = regex::Regex::new(r#"(?is)<(a|link|img|script|source|iframe|area)\b([^>]*)>"#).expect("tag pattern");
    let attr = regex::Regex::new(r#"(?is)\s(href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).expect("attr pattern");
    let mut out = Vec::new();
    // Text inside these elements isn't markup a visitor follows.
    let mut html = html.to_string();
    for element in ["template", "noscript", "textarea", "code", "pre"] {
        let quiet = regex::Regex::new(&format!(r"(?is)<{element}\b.*?</{element}\s*>")).expect("quiet pattern");
        html = quiet.replace_all(&html, "").into_owned();
    }
    let rel = regex::Regex::new(r#"(?is)\srel\s*=\s*(?:"([^"]*)"|'([^']*)')"#).expect("rel pattern");
    for t in tag.captures_iter(&html) {
        let name = t[1].to_ascii_lowercase();
        let attrs = &t[2];
        // A `<link>` a reader or an agent follows: a stylesheet, an icon, a preload, an alternate
        // form (a Markdown twin, a feed) or the canonical URL. WordPress's API discovery links,
        // shortlink and pingback are for its own clients.
        if name == "link" {
            let rels = rel
                .captures(attrs)
                .and_then(|c| c.get(1).or(c.get(2)))
                .map(|m| m.as_str().to_ascii_lowercase())
                .unwrap_or_default();
            if !rels.split_whitespace().any(|r| {
                matches!(
                    r,
                    "stylesheet"
                        | "icon"
                        | "apple-touch-icon"
                        | "preload"
                        | "modulepreload"
                        | "manifest"
                        | "alternate"
                        | "canonical"
                )
            }) {
                continue;
            }
        }
        // A `<link>` that isn't a resource (canonical, alternate, preconnect) is still a URL the
        // page publishes: check it as a page, but don't follow it further.
        for a in attr.captures_iter(attrs) {
            let value = a.get(2).or(a.get(3)).map(|m| decode(m.as_str())).unwrap_or_default();
            match &a[1].to_ascii_lowercase()[..] {
                "srcset" => {
                    for candidate in value.split(',') {
                        if let Some(url) = candidate.split_whitespace().next() {
                            out.push((url.to_string(), false));
                        }
                    }
                }
                "href" => out.push((value, name == "a" || name == "area")),
                _ => out.push((value, false)),
            }
        }
    }
    out
}

/// The ids and names a page has for `#fragment` links.
fn anchors(html: &str) -> BTreeSet<String> {
    let re = regex::Regex::new(r#"(?is)<[a-z][a-z0-9-]*\b[^>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')"#)
        .expect("anchor pattern");
    re.captures_iter(html)
        .filter_map(|c| c.get(1).or(c.get(2)).map(|m| decode(m.as_str())))
        .collect()
}

/// The character references attribute values carry in practice.
fn decode(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&#038;", "&")
        .replace("&#38;", "&")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

/// Checks the site at `site`.
pub fn check(site: &Url, fetch: &dyn Fetch) -> Report {
    let mut fetched: BTreeMap<String, Fetched> = BTreeMap::new();
    let mut queue: VecDeque<Url> = VecDeque::new();
    let mut queued = BTreeSet::new();
    // Each link as written, on the page it's on: (page, href, absolute URL without its fragment, fragment).
    let mut found: Vec<(String, String, Url, Option<String>)> = Vec::new();
    let mut truncated = false;
    for seed in seeds(site, fetch) {
        let mut seed = seed;
        seed.set_fragment(None);
        if queued.insert(page_key(&seed)) {
            queue.push_back(seed);
        }
    }
    let get = |url: &Url, fetched: &mut BTreeMap<String, Fetched>| {
        let key = url.to_string();
        if !fetched.contains_key(&key) {
            let entry = match fetch.get(url) {
                Ok((status, html, location)) => Fetched {
                    status,
                    html,
                    location: location.and_then(|l| url.join(&l).ok()),
                },
                Err(_) => Fetched {
                    status: 0,
                    html: None,
                    location: None,
                },
            };
            fetched.insert(key.clone(), entry);
        }
        key
    };
    let mut pages = 0;
    while let Some(url) = queue.pop_front() {
        if pages >= LIMIT {
            truncated = true;
            break;
        }
        let key = get(&url, &mut fetched);
        // A page is an HTML answer; a Markdown twin or a feed listed in a seed is checked, not read.
        let Some(html) = fetched[&key]
            .html
            .clone()
            .filter(|b| b.trim_start().starts_with('<') && !b.trim_start().starts_with("<?xml"))
        else {
            continue;
        };
        pages += 1;
        for (href, page) in links(&html) {
            let href = href.trim().to_string();
            if href.is_empty()
                || href.starts_with("mailto:")
                || href.starts_with("tel:")
                || href.starts_with("javascript:")
                || href.starts_with("data:")
            {
                continue;
            }
            let Ok(mut target) = url.join(&href) else {
                found.push((key.clone(), href.clone(), url.clone(), Some(String::new())));
                continue;
            };
            if !matches!(target.scheme(), "http" | "https") || !same_site(site, &target) || wordpress_own(site, &target)
            {
                continue;
            }
            let fragment = target.fragment().filter(|f| !f.is_empty()).map(percent_decode);
            target.set_fragment(None);
            found.push((key.clone(), href.clone(), target.clone(), fragment));
            if page && queued.insert(page_key(&target)) {
                queue.push_back(target);
            }
        }
    }
    // Every link once: fetch what wasn't, follow same-site redirects, then judge.
    let mut broken = BTreeSet::new();
    for (on, href, target, fragment) in found {
        if fragment.as_deref() == Some("") && href.contains("://") && Url::parse(&href).is_err() {
            broken.insert(Broken {
                on,
                href,
                problem: "isn't a valid URL".into(),
            });
            continue;
        }
        let mut current = target.clone();
        let mut hops = 0;
        let (status, html) = loop {
            let key = get(&current, &mut fetched);
            let entry = &fetched[&key];
            match (&entry.location, entry.status) {
                (Some(next), 300..=399) if hops < 5 && same_site(site, next) => {
                    let mut next = next.clone();
                    next.set_fragment(None);
                    current = next;
                    hops += 1;
                }
                (_, status) => break (status, entry.html.clone()),
            }
        };
        if !(200..300).contains(&status) && !(300..400).contains(&status) {
            let problem = if status == 0 {
                "couldn't be read".to_string()
            } else {
                format!("answers {status}")
            };
            broken.insert(Broken { on, href, problem });
            continue;
        }
        if let (Some(fragment), Some(html)) = (fragment, html) {
            // `#top` and an empty fragment go to the top of any page, as browsers do.
            if fragment != "top" && !anchors(&html).contains(&fragment) {
                broken.insert(Broken {
                    on,
                    href,
                    problem: format!("{} has no element with id \"{fragment}\"", local(site, &current)),
                });
            }
        }
    }
    Report {
        pages,
        broken: broken
            .into_iter()
            .map(|b| Broken {
                on: local(site, &Url::parse(&b.on).expect("a fetched URL")),
                ..b
            })
            .collect(),
        truncated,
    }
}

/// A page's path below the site, without a trailing slash: how the report names it.
fn local(site: &Url, url: &Url) -> String {
    let base = site.path().trim_end_matches('/');
    let path = url.path().strip_prefix(base).unwrap_or(url.path());
    let path = match path.trim_end_matches('/') {
        "" => "/",
        trimmed => trimmed,
    };
    match url.query() {
        Some(q) => format!("{path}?{q}"),
        None => path.to_string(),
    }
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Some(hex) = text.get(i + 1..i + 3)
            && let Ok(b) = u8::from_str_radix(hex, 16)
        {
            out.push(b);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// A site in memory: path → (status, body, location).
    struct Stub(HashMap<String, (u16, &'static str, Option<&'static str>)>);

    impl Fetch for Stub {
        fn get(&self, url: &Url) -> Result<(u16, Option<String>, Option<String>), String> {
            let key = match url.query() {
                Some(q) => format!("{}?{q}", url.path()),
                None => url.path().to_string(),
            };
            Ok(match self.0.get(&key) {
                Some((status, body, location)) => (*status, Some(body.to_string()), location.map(str::to_string)),
                None => (404, Some(String::new()), None),
            })
        }
    }

    fn site(pages: &[(&str, u16, &'static str, Option<&'static str>)]) -> Stub {
        Stub(pages.iter().map(|(p, s, b, l)| (p.to_string(), (*s, *b, *l))).collect())
    }

    #[test]
    fn follows_the_site_and_reports_each_broken_link_once() {
        let stub = site(&[
            (
                "/",
                200,
                r##"<a href="/guide">Guide</a> <a href="/gone">Gone</a> <a href="https://elsewhere.test/x">x</a> <img src="/logo.svg"> <a href="#top">Top</a>"##,
                None,
            ),
            (
                "/guide",
                200,
                r##"<h2 id="install">Install</h2><a href="/#missing">Home</a><a href="/old#install">Old</a><a href="/gone">Gone again</a><link rel="stylesheet" href="/site.css">"##,
                None,
            ),
            ("/old", 301, "", Some("/guide")),
            ("/logo.svg", 200, "", None),
            ("/site.css", 200, "", None),
        ]);
        let report = check(&Url::parse("http://site.test/").unwrap(), &stub);
        assert_eq!(report.pages, 2);
        assert_eq!(
            report.broken,
            vec![
                Broken {
                    on: "/".into(),
                    href: "/gone".into(),
                    problem: "answers 404".into()
                },
                Broken {
                    on: "/guide".into(),
                    href: "/#missing".into(),
                    problem: "/ has no element with id \"missing\"".into()
                },
                Broken {
                    on: "/guide".into(),
                    href: "/gone".into(),
                    problem: "answers 404".into()
                },
            ]
        );
    }

    #[test]
    fn reads_the_sitemap_and_llms_txt_for_pages_no_link_reaches() {
        let stub = site(&[
            ("/", 200, "<p>Home</p>", None),
            (
                "/wp-sitemap.xml",
                200,
                "<sitemapindex><sitemap><loc>http://site.test/wp-sitemap-posts-1.xml</loc></sitemap></sitemapindex>",
                None,
            ),
            (
                "/wp-sitemap-posts-1.xml",
                200,
                "<urlset><url><loc>http://site.test/lonely</loc></url></urlset>",
                None,
            ),
            (
                "/llms.txt",
                200,
                "- [Agents](http://site.test/agents.md): for agents",
                None,
            ),
            ("/lonely", 200, r#"<a href="/missing.png">x</a>"#, None),
            ("/agents.md", 200, "# Agents", None),
        ]);
        let report = check(&Url::parse("http://site.test/").unwrap(), &stub);
        assert_eq!(
            report.broken,
            vec![Broken {
                on: "/lonely".into(),
                href: "/missing.png".into(),
                problem: "answers 404".into()
            }]
        );
    }

    #[test]
    fn leaves_wordpress_own_paths_code_and_other_sites_alone() {
        let stub = site(&[(
            "/",
            200,
            r#"<a href="/wp-admin/">Admin</a> <a href="/wp-login.php?action=x">Log in</a> <pre><a href="/in-code">x</a></pre> <code>&lt;a href="/also">x&lt;/a></code> <a href="mailto:a@b.c">Mail</a> <a href="https://other.test/gone">Other</a>"#,
            None,
        )]);
        let report = check(&Url::parse("http://site.test/").unwrap(), &stub);
        assert_eq!(report.broken, vec![]);
    }

    #[test]
    fn reads_a_page_once_with_or_without_its_slash_and_skips_wordpress_discovery_links() {
        let stub = site(&[
            (
                "/",
                200,
                r#"<link rel="shortlink" href="/?p=9"><link rel='https://api.w.org/' href="/wp-json/"><link rel="alternate" type="text/markdown" href="/index.md"><a href="/a">A</a><a href="/a/">A again</a><a href="/b">B</a>"#,
                None,
            ),
            ("/index.md", 200, "# Home", None),
            ("/a", 200, r#"<a href="/gone">x</a>"#, None),
            ("/a/", 200, r#"<a href="/gone">x</a>"#, None),
            ("/b", 200, r#"<link rel="stylesheet" href="/missing.css">"#, None),
        ]);
        let report = check(&Url::parse("http://site.test/").unwrap(), &stub);
        assert_eq!(report.pages, 3);
        assert_eq!(
            report.broken,
            vec![
                Broken {
                    on: "/a".into(),
                    href: "/gone".into(),
                    problem: "answers 404".into()
                },
                Broken {
                    on: "/b".into(),
                    href: "/missing.css".into(),
                    problem: "answers 404".into()
                },
            ]
        );
    }

    #[test]
    fn a_site_below_a_path_checks_only_below_it() {
        let stub = site(&[
            (
                "/docs/",
                200,
                r#"<a href="/elsewhere">x</a><a href="intro">Intro</a>"#,
                None,
            ),
            ("/docs/intro", 200, "<p>ok</p>", None),
        ]);
        let report = check(&Url::parse("http://site.test/docs/").unwrap(), &stub);
        assert_eq!((report.pages, report.broken), (2, vec![]));
    }

    #[test]
    fn decodes_fragments_and_attribute_references() {
        let stub = site(&[
            (
                "/",
                200,
                r#"<h2 id="café">C</h2><a href="/#caf%C3%A9">ok</a><a href="/?a=1&amp;b=2#x">q</a>"#,
                None,
            ),
            ("/?a=1&b=2", 200, r#"<a name="x"></a>"#, None),
        ]);
        let report = check(&Url::parse("http://site.test/").unwrap(), &stub);
        assert_eq!(report.broken, vec![]);
    }
}
