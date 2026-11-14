//! `first export [dir] [--out dir] [--site url] [--base /path] [--site-url https://…]`: the app's
//! `first/app/` pages as a static site that needs no WordPress to serve it
//! (docs/decisions/2026-11-13-static-output.md).
//!
//! The project must say `output: "static"`. Pages are rendered by a WordPress running the build:
//! - without `--site`, a throwaway WordPress on SQLite (the Studio runner `first dev` uses), with the
//!   build's plugins and `first/content/` seeded as a publish seeds a Space; it is removed after;
//! - with `--site`, the hosted site, which must run this checkout's build, with an editor's
//!   `FIRST_APP_PASSWORD` or `FIRST_TOKEN`.
//!
//! Each URL the site lists (`GET /__first/api/v1/prerender`) is fetched as a signed-out visitor with
//! its prerender token, with its Markdown twin. The export writes `<path>.html` and `<path>.md`,
//! `404.html`, `sitemap.xml`, `llms.txt`, `robots.txt`, `_redirects` with a refresh page at each old
//! URL, and every same-site file the pages reference (stylesheets, images, script modules including
//! the Interactivity API runtime) at the path WordPress serves it from. Same-site URLs become
//! root-relative, under `--base`.
//!
//! A page that renders a link to a same-site URL the export does not contain (a page rendered per
//! request, the sign-in or comment form, the REST API) is refused, with the page and the fix: the
//! link would 404 on the static host. With `--site`, sign-in, comment and action URLs stay on the
//! hosted site and keep working there.

use crate::sync::client::{Client, Credential};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ExitCode, Stdio};
use std::time::Duration;

const USAGE: &str = "usage: first export [dir] [--out dir] [--site url] [--base /path] [--site-url https://example.com]\n       with --site: FIRST_APP_PASSWORD=<user:application-password> or FIRST_TOKEN=<bearer token> (an editor's)";

/// WordPress endpoints a page may link or post to that stay on the hosted site with `--site`.
const HOSTED: &[&str] = &["/wp-login.php", "/wp-comments-post.php", "/wp-admin", "/identity"];

/// The default output, below the project.
pub const OUT: &str = "first/dist/static";

struct Flags {
    project: PathBuf,
    out: Option<PathBuf>,
    site: Option<String>,
    base: String,
    site_url: Option<String>,
}

fn parse(args: &[String]) -> Result<Flags, String> {
    let mut flags = Flags {
        project: PathBuf::from("."),
        out: None,
        site: None,
        base: String::new(),
        site_url: None,
    };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut value = |name: &str| it.next().cloned().ok_or(format!("{name} needs a value\n{USAGE}"));
        match a.as_str() {
            "--out" => flags.out = Some(PathBuf::from(value("--out")?)),
            "--site" => flags.site = Some(value("--site")?),
            "--base" => {
                let base = value("--base")?;
                let trimmed = base.trim_matches('/');
                if !trimmed
                    .split('/')
                    .all(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c)))
                    && !trimmed.is_empty()
                {
                    return Err(format!("--base is a URL path like /docs, not {base}"));
                }
                flags.base = if trimmed.is_empty() {
                    String::new()
                } else {
                    format!("/{trimmed}")
                };
            }
            "--site-url" => {
                let url = value("--site-url")?;
                let parsed = url::Url::parse(&url).map_err(|e| format!("--site-url: {e}"))?;
                if !matches!(parsed.scheme(), "http" | "https") || parsed.query().is_some() {
                    return Err("--site-url is the address the export is served at, like https://example.com".into());
                }
                flags.site_url = Some(url.trim_end_matches('/').to_string());
            }
            other if other.starts_with('-') => return Err(format!("unknown option {other}\n{USAGE}")),
            other => flags.project = PathBuf::from(other),
        }
    }
    Ok(flags)
}

pub(crate) fn cli(args: &[String]) -> ExitCode {
    let flags = match parse(args) {
        Ok(flags) => flags,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };
    match run(flags) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(1)
        }
    }
}

fn run(flags: Flags) -> Result<(), String> {
    let started = std::time::Instant::now();
    let project = flags
        .project
        .canonicalize()
        .map_err(|e| format!("{}: {e}", flags.project.display()))?;
    let built = super::build::build(&project, super::build::frozen(false))
        .map_err(|d| crate::diag::render(&d, &project).trim_end().to_string())?;
    if built.schema.output != crate::schema::Output::Static {
        return Err(
            "first export writes a site with no WordPress, and this app renders pages on WordPress: set `output: \"static\"` in first.config.ts. To prebuild some pages on a WordPress site, export `prerender = true` from them instead"
                .into(),
        );
    }
    if built.schema.app.as_ref().is_none_or(|a| a.routes.is_empty()) {
        return Err("first export renders first/app/, and this project has no pages: add first/app/page.tsx".into());
    }
    let out = flags.out.clone().unwrap_or_else(|| project.join(OUT));
    if project.starts_with(&out) {
        return Err("--out can't contain the project".into());
    }
    // The build the pages render from. Local: this checkout's, written as `first build` writes it.
    let (site, credential, _local) = match &flags.site {
        Some(site) => {
            let env = |name: &str| std::env::var(name).ok().filter(|s| !s.is_empty());
            let credential = match (env("FIRST_APP_PASSWORD"), env("FIRST_TOKEN")) {
                (Some(_), Some(_)) => return Err("set FIRST_APP_PASSWORD or FIRST_TOKEN, not both".into()),
                (Some(p), None) => Credential::AppPassword(p),
                (None, Some(t)) => Credential::Bearer(t),
                (None, None) => return Err(format!("first export --site needs an editor's credential\n{USAGE}")),
            };
            (site.trim_end_matches('/').to_string(), credential, None)
        }
        None => {
            super::build::emit_project(&project, &built)
                .map_err(|e| format!("couldn't write first/_generated: {e}"))?;
            let content = super::build::emit_wp_content(&project, &project.join(crate::layout::WP_CONTENT), &built)
                .map_err(|e| format!("couldn't write wp-content: {e}"))?;
            let seeds = crate::bundle::seed_records(&crate::loader::Disk, &project, &built.schema)
                .map_err(|d| crate::diag::render(&d, &project).trim_end().to_string())?;
            let local = Local::start(&content, &seeds)?;
            let site = local.url.clone();
            let credential = Credential::AppPassword(local.credential.clone());
            (site, credential, Some(local))
        }
    };
    let client = Client::new(&site, credential)?;
    let listing = client.get("/prerender").map_err(|p| match p.status {
        404 => format!("{site}: no first/app/ pages to export ({})", p.message()),
        401 | 403 => format!(
            "{site}: {}; the credential must be an editor's or an administrator's",
            p.message()
        ),
        _ => format!("{site}: {}", p.message()),
    })?;
    if flags.site.is_some() {
        let local = crate::schema_php::render(&built.schema);
        let hash = {
            use sha2::Digest;
            sha2::Sha256::digest(local.as_bytes())
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        };
        if listing["build"].as_str() != Some(hash.as_str()) {
            return Err(format!(
                "{site} runs another build of this app: export renders the checkout's pages, so deploy this checkout to the site first (or check out what the site runs)"
            ));
        }
    }
    let export = Export::new(&site, &flags, &built.schema, &listing)?;
    let report = export.write(&out)?;
    println!(
        "exported {} pages, {} files and {} redirects -> {} in {:.0?}",
        report.pages,
        report.files,
        report.redirects,
        out.strip_prefix(&project).unwrap_or(&out).display(),
        started.elapsed()
    );
    Ok(())
}

// ------------------------------------------------------------------ the local site

/// The throwaway WordPress `scripts/dev/studio.mjs export` runs; stopped and removed on drop.
struct Local {
    child: Child,
    url: String,
    credential: String,
}

impl Local {
    fn start(content: &Path, seeds: &[(String, Value)]) -> Result<Local, String> {
        let work = tempfile::tempdir().map_err(|e| e.to_string())?;
        let seed = work.path().join("seed");
        std::fs::create_dir(&seed).map_err(|e| e.to_string())?;
        for (name, records) in seeds {
            std::fs::write(seed.join(format!("{name}.json")), records.to_string()).map_err(|e| e.to_string())?;
        }
        let mut command = super::dev::export_command()?;
        command
            .arg(content)
            .arg(&seed)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        eprintln!("starting a local WordPress for the export…");
        let mut child = command
            .spawn()
            .map_err(|e| format!("first export needs Node.js 22+ and npm (npx): {e}"))?;
        let stdout = child.stdout.take().expect("piped");
        let mut line = String::new();
        std::io::BufReader::new(stdout)
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        let ready: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                let _ = child.kill();
                let mut err = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    let _ = std::io::Read::read_to_string(&mut stderr, &mut err);
                }
                return Err(format!("the local WordPress didn't start:\n{line}{err}"));
            }
        };
        // The seed directory was copied into the site; the temp directory goes now.
        drop(work);
        Ok(Local {
            url: ready["url"].as_str().unwrap_or_default().to_string(),
            credential: ready["credential"].as_str().unwrap_or_default().to_string(),
            child,
        })
    }
}

impl Drop for Local {
    fn drop(&mut self) {
        // Closing standard input tells the runner to stop and remove the site.
        drop(self.child.stdin.take());
        let _ = self.child.wait();
    }
}

// ------------------------------------------------------------------ fetching and writing

/// A response: status, lowercase header names to values, and the body.
type Fetched = (u16, BTreeMap<String, String>, Vec<u8>);

struct Page {
    path: String,
    html: String,
    markdown: Option<String>,
}

struct Report {
    pages: usize,
    files: usize,
    redirects: usize,
}

struct Export<'a> {
    agent: ureq::Agent,
    /// The rendering site: scheme, host and port, and its home path.
    origin: String,
    home: String,
    flags: &'a Flags,
    listing: &'a Value,
    name: String,
    /// Public actions by name: a client component may call them on `--site`.
    public_actions: BTreeMap<String, bool>,
    islands: Vec<(String, Vec<String>)>,
}

impl<'a> Export<'a> {
    fn new(site: &str, flags: &'a Flags, schema: &crate::schema::Schema, listing: &'a Value) -> Result<Self, String> {
        let home = url::Url::parse(listing["home"].as_str().unwrap_or(site)).map_err(|e| e.to_string())?;
        let origin = home.origin().ascii_serialization();
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(120)))
            .http_status_as_error(false)
            .max_redirects(0)
            .build()
            .into();
        Ok(Export {
            agent,
            origin,
            home: home.path().trim_end_matches('/').to_string(),
            flags,
            listing,
            name: crate::schema::title_case(&schema.name),
            public_actions: listing["actions"]
                .as_object()
                .map(|m| m.iter().map(|(k, v)| (k.clone(), v == true)).collect())
                .unwrap_or_default(),
            islands: schema
                .islands
                .iter()
                .map(|(ns, i)| (ns.clone(), i.actions.clone()))
                .collect(),
        })
    }

    /// GET a path below the site's origin, with a prerender token when given: (status, headers, body).
    fn get(&self, path: &str, token: Option<&str>) -> Result<Fetched, String> {
        let url = format!("{}{path}", self.origin);
        let mut request = self.agent.get(&url).header("X-First-Export", "1");
        if let Some(token) = token {
            request = request.header("X-First-Prerender", token);
        }
        let mut response = request.call().map_err(|e| format!("GET {url}: {e}"))?;
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .map(|(k, v)| {
                (
                    k.as_str().to_ascii_lowercase(),
                    v.to_str().unwrap_or_default().to_string(),
                )
            })
            .collect();
        let body = response
            .body_mut()
            .with_config()
            .limit(64 * 1024 * 1024)
            .read_to_vec()
            .map_err(|e| format!("GET {url}: {e}"))?;
        Ok((status, headers, body))
    }

    fn pages(&self) -> Result<Vec<Page>, String> {
        let mut pages = Vec::new();
        for url in self.listing["urls"].as_array().into_iter().flatten() {
            let path = url["path"].as_str().unwrap_or("/").to_string();
            let route = url["route"].as_str().unwrap_or_default();
            let full = format!("{}{}", self.home, if path == "/" { "/" } else { &path });
            let (status, headers, body) = self.get(&full, url["token"].as_str())?;
            if let Some(function) = headers.get("x-first-prerender-refused") {
                return Err(format!(
                    "{path} (app/{route}): the page calls `{function}`, which asks who the visitor is, and a static page is one file for everyone. Move that into a client component, or leave it out"
                ));
            }
            match status {
                200 => {}
                301 | 302 | 303 | 307 | 308 => {
                    return Err(format!(
                        "{path} (app/{route}) redirects to {}; a static page can't redirect. Link to the destination instead, or remove the redirect()",
                        headers.get("location").map(String::as_str).unwrap_or("?")
                    ));
                }
                404 => {
                    return Err(format!(
                        "{path} (app/{route}) is listed but renders a 404: its staticParams lists a value the page calls notFound() for. Leave that value out of staticParams"
                    ));
                }
                status => {
                    return Err(format!(
                        "{path} (app/{route}) failed to render (HTTP {status}); the site's error log has the cause"
                    ));
                }
            }
            let twin = &url["twin"];
            let markdown = match twin["path"].as_str() {
                Some(twin_path) => {
                    let (status, _, body) = self.get(twin_path, twin["token"].as_str())?;
                    (status == 200).then(|| String::from_utf8_lossy(&body).into_owned())
                }
                None => None,
            };
            pages.push(Page {
                path,
                html: String::from_utf8_lossy(&body).into_owned(),
                markdown,
            });
        }
        Ok(pages)
    }

    fn write(&self, out: &Path) -> Result<Report, String> {
        let pages = self.pages()?;
        let exported: BTreeSet<String> = pages.iter().map(|p| p.path.clone()).collect();
        let nf = &self.listing["notFound"];
        let (_, _, not_found) = self.get(
            nf["path"].as_str().unwrap_or("/__first-not-found"),
            nf["token"].as_str(),
        )?;
        let not_found = String::from_utf8_lossy(&not_found).into_owned();
        let redirects: Vec<(String, String)> = self.listing["redirects"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|r| Some((r["from"].as_str()?.to_string(), r["to"].as_str()?.to_string())))
            .filter(|(from, _)| !exported.contains(from))
            .collect();
        let moved: BTreeSet<String> = redirects.iter().map(|(from, _)| from.clone()).collect();
        // Write into a fresh directory beside the output, then swap it in: a failed export leaves
        // the last good one.
        let parent = out.parent().ok_or("--out needs a parent directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let stage = tempfile::Builder::new()
            .prefix(".first-export-")
            .tempdir_in(parent)
            .map_err(|e| e.to_string())?;
        let mut assets: BTreeSet<String> = BTreeSet::new();
        let mut refusals = Vec::new();
        for page in &pages {
            let mut html = self.rewrite(&page.html, &page.path, &exported, &moved, &mut assets, &mut refusals);
            // With --site-url, a page names its own address: the one the export is served at.
            if self.flags.site_url.is_some() && !html.contains("rel=\"canonical\"") {
                let link = format!(
                    "<link rel=\"canonical\" href=\"{}\">\n",
                    xml(&self.absolute(&page.path))
                );
                html = html.replacen("</head>", &format!("{link}</head>"), 1);
            }
            write(&stage.path().join(file_of(&page.path, "html")), html.as_bytes())?;
            if let Some(md) = &page.markdown {
                write(
                    &stage.path().join(file_of(&page.path, "md")),
                    self.rewrite_markdown(md).as_bytes(),
                )?;
            }
        }
        let html = self.rewrite(&not_found, "/404", &exported, &moved, &mut assets, &mut refusals);
        write(&stage.path().join("404.html"), html.as_bytes())?;
        if !refusals.is_empty() {
            refusals.sort();
            refusals.dedup();
            return Err(format!(
                "the export would link to URLs a static site doesn't have:\n{}",
                refusals.iter().map(|r| format!("  {r}")).collect::<Vec<_>>().join("\n")
            ));
        }
        // Assets, and what they reference in turn (a stylesheet's fonts and images, a module's imports).
        let mut files = 0;
        let mut queue: Vec<String> = assets.into_iter().collect();
        let mut seen: BTreeSet<String> = queue.iter().cloned().collect();
        while let Some(path) = queue.pop() {
            let (status, _, body) = self.get(&format!("{}{path}", self.home), None)?;
            if status != 200 {
                return Err(format!(
                    "{path} answered {status}; the pages reference it, so the export needs it"
                ));
            }
            let mut body = body;
            if path.ends_with(".css") || path.ends_with(".js") {
                let text = String::from_utf8_lossy(&body).into_owned();
                for found in self.referenced(&text, &path) {
                    if seen.insert(found.clone()) {
                        queue.push(found);
                    }
                }
                body = self.relink(&text).into_bytes();
            }
            write(&stage.path().join(path.trim_start_matches('/')), &body)?;
            files += 1;
        }
        // Redirects: a `_redirects` file, and a refresh page at each old URL for hosts without rules.
        let mut rules = String::new();
        for (from, to) in &redirects {
            rules.push_str(&format!("{}{from} {}{to} 301\n", self.flags.base, self.flags.base));
            let target = format!("{}{to}", self.flags.base);
            let page = format!(
                "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\"><title>Moved</title><link rel=\"canonical\" href=\"{}\"><meta http-equiv=\"refresh\" content=\"0; url={target}\"></head><body><p><a href=\"{target}\">This page has moved.</a></p></body></html>\n",
                self.absolute(to)
            );
            write(&stage.path().join(file_of(from, "html")), page.as_bytes())?;
        }
        if !rules.is_empty() {
            write(&stage.path().join("_redirects"), rules.as_bytes())?;
        }
        // A sitemap lists absolute URLs (sitemaps.org), so it needs to know where the site is served.
        let mut robots = String::from("User-agent: *\nAllow: /\n");
        if self.flags.site_url.is_some() {
            write(&stage.path().join("sitemap.xml"), self.sitemap(&pages).as_bytes())?;
            robots.push_str(&format!("\nSitemap: {}\n", self.absolute("/sitemap.xml")));
        } else {
            eprintln!("note: no sitemap.xml; pass --site-url https://… (where the export is served) to write one");
        }
        write(&stage.path().join("llms.txt"), self.llms(&pages).as_bytes())?;
        write(&stage.path().join("robots.txt"), robots.as_bytes())?;
        let stage = stage.keep();
        if out.exists() {
            let old = out.with_extension(format!("old-{}", std::process::id()));
            std::fs::rename(out, &old).map_err(|e| e.to_string())?;
            std::fs::rename(&stage, out).map_err(|e| e.to_string())?;
            let _ = std::fs::remove_dir_all(old);
        } else {
            std::fs::rename(&stage, out).map_err(|e| e.to_string())?;
        }
        Ok(Report {
            pages: pages.len(),
            files,
            redirects: redirects.len(),
        })
    }

    /// The URL a path is served at: `--site-url` when given, else root-relative under `--base`.
    fn absolute(&self, path: &str) -> String {
        format!(
            "{}{}{path}",
            self.flags.site_url.as_deref().unwrap_or(""),
            self.flags.base
        )
    }

    /// A same-site URL as a path below the home path, or None for another site's URL.
    fn local_path(&self, url: &str) -> Option<String> {
        let rest = if let Some(rest) = url.strip_prefix(&self.origin) {
            rest
        } else if url.starts_with('/') && !url.starts_with("//") {
            url
        } else {
            return None;
        };
        let rest = if self.home.is_empty() {
            rest
        } else {
            rest.strip_prefix(&self.home)?
        };
        Some(if rest.is_empty() { "/".into() } else { rest.to_string() })
    }

    /// Rewrites a page: same-site URLs become root-relative under `--base`, files go on the asset
    /// list, and a link to a same-site page the export doesn't contain is a refusal.
    fn rewrite(
        &self,
        html: &str,
        page: &str,
        exported: &BTreeSet<String>,
        moved: &BTreeSet<String>,
        assets: &mut BTreeSet<String>,
        refusals: &mut Vec<String>,
    ) -> String {
        let attribute = regex::Regex::new(r#"(?i)\b(href|src|action|content)=("([^"]*)"|'([^']*)')"#).expect("regex");
        let mut out = String::with_capacity(html.len());
        let mut last = 0;
        for m in attribute.captures_iter(html) {
            let whole = m.get(0).expect("match");
            let name = m[1].to_ascii_lowercase();
            let value = m.get(3).or(m.get(4)).expect("value").as_str();
            let decoded = value.replace("&#038;", "&").replace("&amp;", "&");
            out.push_str(&html[last..whole.start()]);
            last = whole.end();
            let quote = if m.get(3).is_some() { '"' } else { '\'' };
            let Some(local) = (name != "content").then(|| self.local_path(&decoded)).flatten() else {
                out.push_str(whole.as_str());
                continue;
            };
            let (path, suffix) = split_suffix(&local);
            // A file has an extension; a `.php` URL is a WordPress endpoint (sign-in, comments), a
            // page as far as the export is concerned.
            let file = path.rsplit('/').next().unwrap_or_default().contains('.')
                && !path.ends_with(".md")
                && !path.ends_with(".php");
            let new = if file {
                let clean = path.to_string();
                if name == "action" {
                    out.push_str(whole.as_str());
                    continue;
                }
                assets.insert(clean.clone());
                format!("{}{clean}{}", self.flags.base, version_suffix(suffix))
            } else {
                let target = path.trim_end_matches('/');
                let target = if target.is_empty() { "/" } else { target };
                let twin = path.strip_suffix(".md");
                let known = exported.contains(target)
                    || moved.contains(target)
                    || twin.is_some_and(|t| exported.contains(if t == "/index" { "/" } else { t }));
                if !known {
                    let what = if name == "action" {
                        "a form posts to"
                    } else {
                        "it links to"
                    };
                    // With --site, WordPress's own sign-in and comment endpoints stay on the hosted
                    // site, where the visitor finishes signing in or commenting.
                    if let Some(site) = &self.flags.site
                        && HOSTED
                            .iter()
                            .any(|h| target == *h || target.starts_with(&format!("{h}/")))
                    {
                        out.push_str(&format!(
                            "{}={quote}{}{}{suffix}{quote}",
                            &m[1],
                            site.trim_end_matches('/'),
                            target
                        ));
                        continue;
                    }
                    refusals.push(format!(
                        "{page}: {what} {target}, which isn't in the export. Prebuild that page (output: \"static\" prebuilds every first/app/ page; a dynamic one needs staticParams), or link to another site's URL"
                    ));
                }
                format!("{}{target}{suffix}", self.flags.base)
            };
            out.push_str(&format!("{}={quote}{}{quote}", &m[1], new.replace('&', "&amp;")));
        }
        out.push_str(&html[last..]);
        let out = self.config(&out, page, refusals);
        let out = self.inline_styles(&out, assets);
        self.import_map(&out, assets)
    }

    /// `<style>` blocks (core's font faces, block styles): their `url(...)` files are exported too.
    fn inline_styles(&self, html: &str, assets: &mut BTreeSet<String>) -> String {
        let re = regex::Regex::new(r#"(?s)(<style[^>]*>)(.*?)(</style>)"#).expect("regex");
        re.replace_all(html, |c: &regex::Captures| {
            for found in self.referenced(&c[2], "/inline.css") {
                assets.insert(found);
            }
            format!("{}{}{}", &c[1], self.relink(&c[2]), &c[3])
        })
        .into_owned()
    }

    /// The Interactivity API's import map: its module URLs are files of the export.
    fn import_map(&self, html: &str, assets: &mut BTreeSet<String>) -> String {
        let re = regex::Regex::new(r#"(?s)(<script[^>]*type="importmap"[^>]*>)(.*?)(</script>)"#).expect("regex");
        re.replace_all(html, |c: &regex::Captures| {
            let Ok(mut map) = serde_json::from_str::<Value>(&c[2]) else {
                return c[0].to_string();
            };
            if let Some(imports) = map["imports"].as_object_mut() {
                for value in imports.values_mut() {
                    if let Some(local) = value.as_str().and_then(|u| self.local_path(u)) {
                        let (path, suffix) = split_suffix(&local);
                        assets.insert(path.to_string());
                        *value = Value::String(format!("{}{path}{}", self.flags.base, version_suffix(suffix)));
                    }
                }
            }
            format!("{}{}{}", &c[1], map, &c[3])
        })
        .into_owned()
    }

    /// Client component configuration (`wp-script-module-data-*`): action endpoints stay on the
    /// hosted site with `--site` (public actions only); without one, a component that calls an action
    /// is refused.
    fn config(&self, html: &str, page: &str, refusals: &mut Vec<String>) -> String {
        let re = regex::Regex::new(
            r#"(?s)(<script id="wp-script-module-data-([^"]+)" type="application/json">)(.*?)(</script>)"#,
        )
        .expect("regex");
        re.replace_all(html, |c: &regex::Captures| {
            let Ok(mut data) = serde_json::from_str::<Value>(&c[3]) else { return c[0].to_string() };
            let mut changed = false;
            // core/router's server URL: the page's address where the export is served.
            if let Some(url) = data["state"]["core/router"]["url"].as_str()
                && let Some(local) = self.local_path(url)
            {
                let (path, suffix) = split_suffix(&local);
                let served = format!("{}{}", self.flags.site_url.as_deref().unwrap_or(""), self.flags.base);
                data["state"]["core/router"]["url"] = Value::String(format!("{served}{path}{suffix}"));
                changed = true;
            }
            if let Some(namespaces) = data["config"].as_object_mut() {
                for (namespace, config) in namespaces.iter_mut() {
                    let Some(actions) = config["actions"].as_object_mut() else { continue };
                    for (action, url) in actions.iter_mut() {
                        match &self.flags.site {
                            None => refusals.push(format!(
                                "{page}: the client component {namespace} calls the action `{action}`, and a static site has no server to run it. Export with --site <url> to call it on the hosted site, or remove the call"
                            )),
                            Some(_) if self.public_actions.get(action) != Some(&true) => refusals.push(format!(
                                "{page}: the client component {namespace} calls the action `{action}`, which isn't `access: \"anyone\"`; a visitor of the static site isn't signed in to the hosted one. Make the action public, or remove the call"
                            )),
                            Some(site) => {
                                // Absolute on the hosted site, which answers it cross-origin (the API's CORS).
                                if let Some(local) = url.as_str().and_then(|u| self.local_path(u)) {
                                    *url = Value::String(format!("{}{}", site.trim_end_matches('/'), local));
                                    changed = true;
                                }
                            }
                        }
                    }
                }
            }
            let _ = &self.islands;
            if changed {
                format!("{}\n{}\n{}", &c[1], data, &c[4])
            } else {
                c[0].to_string()
            }
        })
        .into_owned()
    }

    fn rewrite_markdown(&self, md: &str) -> String {
        md.replace(
            &format!("{}{}", self.origin, self.home),
            &self
                .flags
                .site_url
                .clone()
                .map(|u| format!("{u}{}", self.flags.base))
                .unwrap_or_else(|| self.flags.base.clone()),
        )
    }

    /// URLs a stylesheet or script module references: `url(...)`, `@import`, and module imports.
    fn referenced(&self, text: &str, from: &str) -> Vec<String> {
        // A stylesheet's `url(...)` and `@import`; a module's static and dynamic imports of a path
        // (`./x.js`, `/wp-includes/…`). Bare specifiers resolve through the import map.
        let re = if from.ends_with(".css") {
            regex::Regex::new(r#"url\(\s*['"]?([^'")]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]()"#)
        } else {
            regex::Regex::new(r#"()()(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s+)['"]((?:\./|\.\./|/)[^'"]+)['"]"#)
        }
        .expect("regex");
        let dir = from.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        let mut out = Vec::new();
        for c in re.captures_iter(text) {
            let raw = c.get(1).or(c.get(2)).or(c.get(3)).expect("group").as_str();
            if raw.starts_with("data:") || raw.starts_with('#') || raw.starts_with("@wordpress/") || raw.contains("${")
            {
                continue;
            }
            let local = if raw.starts_with("http") || raw.starts_with('/') {
                match self.local_path(raw) {
                    Some(p) => p,
                    None => continue,
                }
            } else if raw.starts_with("./") || raw.starts_with("../") || !raw.contains(':') {
                normalize(&format!("{dir}/{raw}"))
            } else {
                continue;
            };
            let (path, _) = split_suffix(&local);
            out.push(path.to_string());
        }
        out
    }

    /// Absolute same-site URLs inside a file become root-relative under `--base`.
    fn relink(&self, text: &str) -> String {
        text.replace(
            &format!("{}{}/", self.origin, self.home),
            &format!("{}/", self.flags.base),
        )
    }

    fn sitemap(&self, pages: &[Page]) -> String {
        let mut out = String::from(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n",
        );
        for page in pages {
            if robots_noindex(&page.html) {
                continue;
            }
            out.push_str(&format!(
                "  <url><loc>{}</loc></url>\n",
                xml(&self.absolute(if page.path == "/" { "/" } else { &page.path }))
            ));
        }
        out.push_str("</urlset>\n");
        out
    }

    fn llms(&self, pages: &[Page]) -> String {
        let mut out = format!(
            "# {}\n\nEvery page has a Markdown version at its URL plus `.md`.\n\n## Pages\n\n",
            self.name
        );
        for page in pages
            .iter()
            .filter(|p| p.markdown.is_some() && !robots_noindex(&p.html))
        {
            let title = page
                .markdown
                .as_deref()
                .and_then(|m| m.lines().find_map(|l| l.strip_prefix("# ")))
                .unwrap_or(&page.path);
            let md = if page.path == "/" {
                "/index.md".to_string()
            } else {
                format!("{}.md", page.path)
            };
            out.push_str(&format!(
                "- [{}]({})\n",
                title.replace(['[', ']'], ""),
                self.absolute(&md)
            ));
        }
        out
    }
}

fn robots_noindex(html: &str) -> bool {
    regex::Regex::new(r#"(?i)<meta name=['"]robots['"] content=['"][^'"]*noindex"#)
        .expect("regex")
        .is_match(html)
}

fn xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// `/a/b?x#y` → (`/a/b`, `?x#y`).
fn split_suffix(path: &str) -> (&str, &str) {
    match path.find(['?', '#']) {
        Some(i) => (&path[..i], &path[i..]),
        None => (path, ""),
    }
}

/// A file's `?ver=…` stays (it names the version for caches); other query strings and fragments go.
fn version_suffix(suffix: &str) -> &str {
    if suffix.starts_with("?ver=") && !suffix.contains('&') {
        suffix
    } else {
        ""
    }
}

/// `/a/./b/../c` → `/a/c`.
fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            p => parts.push(p),
        }
    }
    format!("/{}", parts.join("/"))
}

/// The file a page path is written to: `/` → `index.html`, `/a/b` → `a/b.html`. Each segment is the
/// percent-decoded name a static server maps the URL to.
fn file_of(path: &str, extension: &str) -> PathBuf {
    if path == "/" {
        return PathBuf::from(format!("index.{extension}"));
    }
    let segments: Vec<String> = path
        .trim_matches('/')
        .split('/')
        .map(|s| {
            url::form_urlencoded::parse(format!("x={}", s.replace('+', "%2B")).as_bytes())
                .next()
                .map(|(_, v)| v.into_owned())
                .unwrap_or_default()
        })
        .collect();
    let mut file = PathBuf::new();
    for s in &segments[..segments.len() - 1] {
        file.push(s);
    }
    file.push(format!("{}.{extension}", segments[segments.len() - 1]));
    file
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let mut file = std::fs::File::create(path).map_err(|e| format!("{}: {e}", path.display()))?;
    file.write_all(bytes).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_paths_map_to_the_files_static_hosts_serve() {
        assert_eq!(file_of("/", "html"), PathBuf::from("index.html"));
        assert_eq!(file_of("/docs/intro", "html"), PathBuf::from("docs/intro.html"));
        assert_eq!(file_of("/tags/lab%20notes", "md"), PathBuf::from("tags/lab notes.md"));
        assert_eq!(normalize("/a/b/../c/./d.woff2"), "/a/c/d.woff2");
        assert_eq!(split_suffix("/x.js?ver=1#y"), ("/x.js", "?ver=1#y"));
        assert_eq!(version_suffix("?ver=6a43"), "?ver=6a43");
        assert_eq!(version_suffix("?a=1"), "");
    }
}
