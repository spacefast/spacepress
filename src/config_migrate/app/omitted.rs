//! What a 0.8 publish served that the candidate does not reproduce. A candidate replaces the
//! published version, so anything it leaves out disappears from the Space: every such file and
//! setting is an error (`Z08_OMITTED_*`), never a silent drop.
//!
//! A 0.8 Zero publish served the project root as static content, minus the capsule's own source
//! (`client/`, `server/`, `shared/`, `pages/` and source code anywhere), repository files, its
//! config and the platform's ignore list (zero-compile's `isZeroPublicStaticPath`). Those static
//! files that v2 can serve unchanged are carried into the candidate's `public/`, which v2 serves at
//! the same URLs. The rest are refused here with what replaces them.
use super::super::{Failure, fail, pointer};
use crate::loader::Fs;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub(super) const CLIENT: &str = "the 0.8 client app is not carried over";
pub(super) const PAGES: &str = "the 0.8 page is not carried over";
pub(super) const STATIC: &str = "the static file is not carried over";
pub(super) const REDIRECTS: &str = "the redirect, rewrite and header rules are not carried over";
pub(super) const CLEAN_URLS: &str = "clean URLs are not carried over";
pub(super) const SERVE: &str = "the serving settings are not carried over";
pub(super) const CONNECTORS: &str = "the connector role is not carried over";
pub(super) const SYNC: &str = "content sync is not carried over";
pub(super) const PUBLIC: &str = "public/ is not carried over";

/// Roots that hold the capsule's source, never served as content.
const SOURCE_ROOTS: &[&str] = &["client", "server", "shared", "pages"];
/// Repository files beside a capsule.
const REPOSITORY_FILES: &[&str] = &[
    "AGENTS.md",
    "LICENSE",
    "README.md",
    "bun.lock",
    "bun.lockb",
    "npm-shrinkwrap.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package.json",
    ".gitignore",
    ".npmrc",
    ".netrc",
    "_routes.json",
];
const REPOSITORY_ROOTS: &[&str] = &[".github", "test", "tests", "tools"];
/// Segments the platform never publishes, at any depth.
const IGNORED_SEGMENTS: &[&str] = &[
    ".aws",
    ".git",
    ".hg",
    ".ssh",
    ".svn",
    ".wrangler",
    ".vercel",
    ".netlify",
    ".turbo",
    ".cache",
    ".zero",
    "node_modules",
    ".spacefast",
    ".stattic",
    ".sf",
    ".DS_Store",
    "__MACOSX",
];
const CODE: &[&str] = &["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"];
/// The rule files 0.8 compiled into routing instead of serving.
const RULE_FILES: &[&str] = &["_redirects", "_headers"];
/// The config keys 0.8 applied when serving the version, by the error each one raises.
const SERVING_KEYS: &[(&str, &str)] = &[
    ("redirects", REDIRECTS),
    ("rewrites", REDIRECTS),
    ("headers", REDIRECTS),
    ("cleanUrls", CLEAN_URLS),
    ("fallback", SERVE),
    ("index", SERVE),
    ("listing", SERVE),
    ("serve", SERVE),
    ("inject", SERVE),
    ("firewall", SERVE),
    ("cache", SERVE),
];

/// Files this sweep carries over (`public/<path>` → contents) and the errors for the rest.
pub(super) struct Omitted {
    pub files: BTreeMap<String, String>,
    pub carried: Vec<String>,
}

fn ignored(relative: &str) -> bool {
    let segments: Vec<&str> = relative.split('/').collect();
    segments.iter().any(|s| {
        IGNORED_SEGMENTS.contains(s)
            || s.starts_with("._")
            || s.starts_with(".env")
            || s.starts_with(".dev.vars")
            || [".pem", ".key", ".p12", ".pfx"].iter().any(|e| s.ends_with(e))
    })
}

/// Whether 0.8 served `relative` as static content (zero-compile's `isZeroPublicStaticPath`).
fn served(relative: &str) -> bool {
    let root = relative.split('/').next().unwrap_or("");
    let extension = Path::new(relative).extension().and_then(|e| e.to_str()).unwrap_or("");
    !(SOURCE_ROOTS.contains(&root)
        || REPOSITORY_ROOTS.contains(&root)
        || REPOSITORY_FILES.contains(&relative)
        || super::CONFIG_FILES.contains(&relative)
        || relative == "spacefast.config.ts"
        || relative == ".env.server"
        || relative == ".env.lakebed.server"
        || relative == "theme.json"
        || (root == "content" && CODE.contains(&extension))
        || (relative.starts_with("tsconfig") && relative.ends_with(".json"))
        || CODE.contains(&extension)
        || ignored(relative))
}

/// Every file under `dir`, capsule-relative, without following links.
fn walk(fs: &dyn Fs, root: &Path, dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries = fs.read_dir(dir).unwrap_or_default();
    entries.sort();
    for path in entries {
        let relative = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
        if ignored(&relative.to_string_lossy().replace('\\', "/")) {
            continue;
        }
        if fs.is_dir(&path) && !fs.is_symlink(&path) {
            walk(fs, root, &path, out);
        } else {
            out.push(relative);
        }
    }
}

/// The candidate's omissions. `pages` says which page files converted (by capsule path);
/// `client_layout` whether `client/` was reproduced as the pages layout.
pub(super) fn sweep(
    fs: &dyn Fs,
    root: &Path,
    config: Option<(&str, &serde_json::Value, &str)>,
    converted_pages: &[String],
    client_layout: bool,
    errors: &mut Vec<Failure>,
) -> Omitted {
    let mut out = Omitted {
        files: BTreeMap::new(),
        carried: vec![],
    };
    let mut files = vec![];
    walk(fs, root, root, &mut files);
    let mut client_reported = false;
    // 0.8 built a client with no pages as the whole site and generated its index.html, shadowing
    // the author's (zero-compile's `standaloneClient`).
    let client_app = fs.is_dir(&root.join("client"))
        && !files
            .iter()
            .any(|f| f.starts_with("pages") && f.extension().is_some_and(|e| e == "tsx" || e == "md" || e == "html"));
    for relative in files {
        let name = relative.to_string_lossy().replace('\\', "/");
        let at = format!("/{}", name.replace('~', "~0"));
        let first = name.split('/').next().unwrap_or("");
        let file = |e: Failure| e.located(name.clone(), 1, 1);
        if first == "client" {
            // One error for the client: its files are one app, built by 0.8 into client.js.
            if !client_layout && !client_reported {
                client_reported = true;
                errors.push(fail("/client", format!("{CLIENT}: 0.8 built client/ into the Space's browser app; a v2 candidate has no client bundle yet, so publishing it would remove the app's interface")).located(name.clone(), 1, 1));
            }
            continue;
        }
        if first == "pages" {
            let extension = relative.extension().and_then(|e| e.to_str()).unwrap_or("");
            // 0.8 routed .tsx, .md and .html; converted pages travel as v2 pages.
            if ["tsx", "md", "html"].contains(&extension) && !converted_pages.contains(&name) {
                errors.push(file(fail(
                    &at,
                    format!("{PAGES}: 0.8 served {name} as a page and the candidate has no counterpart"),
                )));
            }
            continue;
        }
        if name == "public" || name.starts_with("public/") {
            // 0.8 served public/ at /public/...; v2 serves public/ at the root, so the URLs move.
            errors.push(file(fail(
                &at,
                format!("{PUBLIC}: 0.8 served {name} at /{name}, and v2 serves public/ at the site root"),
            )));
            continue;
        }
        if RULE_FILES.contains(&name.as_str()) {
            errors.push(file(fail(
                &at,
                format!("{REDIRECTS}: 0.8 applied {name} to every request; v2 has no rule file"),
            )));
            continue;
        }
        if !served(&name) {
            continue;
        }
        // 0.8 generated index.html for a client app, so the author's own one was never served.
        if name == "index.html" && client_app {
            continue;
        }
        let reserved = super::endpoints::RESERVED.contains(&first.to_ascii_lowercase().as_str());
        match fs.read_to_string(&root.join(&relative)) {
            Ok(text) if text == super::manifest::BINARY => errors.push(file(fail(&at, format!("{STATIC}: {name} is not UTF-8 text, and the candidate carries text files only")))),
            Ok(text) if !reserved => {
                out.files.insert(format!("public/{name}"), text);
                out.carried.push(name);
            }
            Ok(_) => errors.push(file(fail(
                &at,
                format!("{STATIC}: /{first} belongs to WordPress or Zero on v2"),
            ))),
            // Binary files (images, fonts) need byte-exact copies, which the text candidate can't hold.
            Err(_) => errors.push(file(fail(
                &at,
                format!("{STATIC}: {name} is not UTF-8 text, and the candidate carries text files only"),
            ))),
        }
    }
    if let Some((config_file, config, text)) = config {
        // The key's line in the config file, where the fix goes.
        let line_of = |key: &str| -> (usize, usize) {
            let needle = format!("\"{key}\"");
            text.lines()
                .enumerate()
                .find_map(|(i, l)| l.find(&needle).map(|c| (i + 1, l[..c].encode_utf16().count() + 1)))
                .unwrap_or((1, 1))
        };
        for (key, reason) in SERVING_KEYS {
            if config.get(key).is_some() {
                let (line, column) = line_of(key);
                errors.push(
                    fail(
                        &pointer(&format!("/{config_file}"), key),
                        format!("{reason}: 0.8 applied {config_file} `{key}` when serving the Space"),
                    )
                    .located(config_file.to_string(), line, column),
                );
            }
        }
        // 0.8 served `<name>.html` at `/<name>` unless cleanUrls was false; v2 serves files as named.
        let clean = config
            .get("cleanUrls")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true);
        if clean
            && config.get("cleanUrls").is_none()
            && out
                .carried
                .iter()
                .any(|f| f.ends_with(".html") && !f.ends_with("index.html"))
        {
            errors.push(
                fail(
                    &pointer(&format!("/{config_file}"), "cleanUrls"),
                    format!("{CLEAN_URLS}: 0.8 served each <name>.html at /<name> by default"),
                )
                .located(config_file.to_string(), 1, 1),
            );
        }
    } else if out
        .carried
        .iter()
        .any(|f| f.ends_with(".html") && !f.ends_with("index.html"))
    {
        errors.push(fail(
            "/cleanUrls",
            format!("{CLEAN_URLS}: 0.8 served each <name>.html at /<name> by default"),
        ));
    }
    out
}
