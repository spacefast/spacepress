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
use regex::{Regex, RegexBuilder};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

pub(super) const CLIENT: &str = "the 0.8 client app is not carried over";
pub(super) const PAGES: &str = "the 0.8 page is not carried over";
pub(super) const STATIC: &str = "the static file is not carried over";
pub(super) const REDIRECTS: &str = "the redirect, rewrite and header rules are not carried over";
pub(super) const CLEAN_URLS: &str = "clean URLs are not carried over";
pub(super) const SERVE: &str = "the serving settings are not carried over";
pub(super) const CONNECTORS: &str = "the connector role is not carried over";
pub(super) const SYNC: &str = "content sync is not carried over";
pub(super) const PUBLIC: &str = "public/ is not carried over";
pub(super) const SYMLINK: &str = "the symbolic link is not carried over";
pub(super) const DENIED: &str = "the credential file is not carried over";
pub(super) const CONFIG: &str = "the setting is not carried over";
pub(super) const UNVERIFIED: &str = "the unverified static file is not carried over";

/// The monorepo's one source deny list, verbatim: `DENIED_SOURCE_PATH_PATTERN` in
/// packages/common/src/utils/source-archive-policy.ts, compiled case-insensitively as there.
/// A directory with one of these names is denied with its whole subtree.
const DENIED_SOURCE_PATH_PATTERN: &str = r"(?:^|/)(?:\.git|\.hg|\.svn|node_modules|\.spacefast|\.stattic|\.ssh|\.aws|\.npmrc|\.netrc|\.pypirc|credentials\.json|\.env(?:rc)?(?:\.[^/]*)?|\.dev\.vars(?:\.[^/]*)?|(?:[^/]*[._-])?id_(?:rsa|dsa|ecdsa|ed25519)(?:[._-][^/]*)?|(?:[^/]*[.-])?private[.-]?key|[^/]*\.(?:pem|key|p12|pfx|crt|jks|keystore))(?:/|$)";
/// `OS_METADATA_PATH_PATTERN` in the same file, case-sensitive.
const OS_METADATA_PATH_PATTERN: &str = r"(?:^|/)(?:\.DS_Store|__MACOSX|\._[^/]*)(?:/|$)";
static DENIED_SOURCE_PATH: LazyLock<Regex> = LazyLock::new(|| {
    RegexBuilder::new(DENIED_SOURCE_PATH_PATTERN)
        .case_insensitive(true)
        .build()
        .expect("deny list")
});
static OS_METADATA_PATH: LazyLock<Regex> = LazyLock::new(|| Regex::new(OS_METADATA_PATH_PATTERN).expect("OS metadata"));
/// Denied directories that hold checkouts and dependencies, not credentials: never source or
/// content, and nearly every local checkout has one, so they are skipped without an error.
const SKIPPED_DIRECTORIES: &[&str] = &[".git", ".hg", ".svn", "node_modules", ".spacefast", ".stattic"];
/// Directories 0.8 never published beyond the deny list (publish-policy's `IGNORED_SEGMENTS`).
const UNPUBLISHED_DIRECTORIES: &[&str] = &[".wrangler", ".vercel", ".netlify", ".turbo", ".cache", ".zero", ".sf"];

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
    "_routes.json",
];
const REPOSITORY_ROOTS: &[&str] = &[".github", "test", "tests", "tools"];
/// zero-compile's `ZERO_SOURCE_CODE_EXTENSIONS`.
const CODE: &[&str] = &["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"];
/// zero-compile's `TYPESCRIPT_SOURCE_FILE`, never served wherever it is.
const TYPESCRIPT: &[&str] = &["ts", "tsx", "mts", "cts"];
/// The rule files 0.8 compiled into routing instead of serving.
const RULE_FILES: &[&str] = &["_redirects", "_headers"];
/// Config keys the candidate reproduces or that change nothing it serves: the converted runtime,
/// the Space's display name (and the old CLI's `space` key) and the editor's schema pointer.
const NO_OP_KEYS: &[&str] = &["$schema", "runtime", "name", "space"];
/// The WordPress-style theme file 0.8 read for the pages' theme tokens (`THEME_JSON_FILE`).
const THEME_JSON: &str = "theme.json";
/// The serving keys with their own error; any other key raises `CONFIG`.
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

/// What the sweep does with a capsule-relative path before deciding whether 0.8 served it.
#[derive(PartialEq)]
enum Policy {
    /// Never source or content (OS metadata, checkouts, dependencies, unpublished tool state).
    Skip,
    /// On the source deny list as a credential: an error, never carried and never dropped.
    Denied,
    Keep,
}

fn policy(relative: &str) -> Policy {
    if OS_METADATA_PATH.is_match(relative) {
        return Policy::Skip;
    }
    // The first denied segment decides: `.git/.env` is checkout state, `.env/x` a credential.
    for segment in relative.split('/') {
        if DENIED_SOURCE_PATH.is_match(segment) {
            let lower = segment.to_ascii_lowercase();
            return if SKIPPED_DIRECTORIES.contains(&lower.as_str()) {
                Policy::Skip
            } else {
                Policy::Denied
            };
        }
        if UNPUBLISHED_DIRECTORIES.contains(&segment) {
            return Policy::Skip;
        }
    }
    Policy::Keep
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
        || relative == THEME_JSON
        // isZeroCapsuleOwnedPath: code inside a source root, and package.json at any depth.
        || (root == "content" && CODE.contains(&extension))
        || relative.rsplit('/').next() == Some("package.json")
        // isZeroProjectOnlyPath: TypeScript anywhere and tsconfig files. Plain JavaScript outside
        // the source roots is the author's content, and 0.8 served it.
        || (!relative.contains('/') && relative.starts_with("tsconfig") && relative.ends_with(".json"))
        || TYPESCRIPT.contains(&extension)
        || policy(relative) != Policy::Keep)
}

/// A capsule's files, capsule-relative, sorted.
#[derive(Default)]
struct Tree {
    files: Vec<PathBuf>,
    /// Symbolic links, never followed: one can point outside the project or at a credential.
    links: Vec<PathBuf>,
    /// Files on the source deny list as credentials, each file of a denied directory included.
    denied: Vec<PathBuf>,
}

fn walk(fs: &dyn Fs, root: &Path, dir: &Path, tree: &mut Tree, denied: bool) {
    let mut entries = fs.read_dir(dir).unwrap_or_default();
    entries.sort();
    for path in entries {
        let relative = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
        let inside = match policy(&relative.to_string_lossy().replace('\\', "/")) {
            Policy::Skip if !denied => continue,
            Policy::Denied => true,
            _ => denied,
        };
        if fs.is_symlink(&path) {
            if inside { &mut tree.denied } else { &mut tree.links }.push(relative);
        } else if fs.is_dir(&path) {
            walk(fs, root, &path, tree, inside);
        } else if inside {
            tree.denied.push(relative);
        } else {
            tree.files.push(relative);
        }
    }
}

/// A finalize manifest records only the capsule's source (code in the source roots, pages,
/// package.json, env files), never the static files 0.8 served beside it. Those can't be checked
/// against the published version, so each one in the source tree is refused rather than carried
/// unchecked or dropped. `verified` lists the recorded paths, which the conversion sweeps itself.
pub(super) fn unverified(
    fs: &dyn Fs,
    root: &Path,
    verified: &std::collections::BTreeSet<String>,
    errors: &mut Vec<Failure>,
) {
    let mut tree = Tree::default();
    walk(fs, root, root, &mut tree, false);
    let name = |p: &PathBuf| p.to_string_lossy().replace('\\', "/");
    let at = |n: &str| format!("/{}", n.replace('~', "~0"));
    for path in tree.denied.iter().map(name).filter(|n| !verified.contains(n)) {
        errors.push(
            fail(
                &at(&path),
                format!("{DENIED}: {path} is on the source deny list, so the candidate leaves it out"),
            )
            .located(path.clone(), 1, 1),
        );
    }
    for link in tree.links.iter().map(name) {
        if SOURCE_ROOTS.contains(&link.split('/').next().unwrap_or("")) {
            continue;
        }
        errors.push(
            fail(
                &at(&link),
                format!("{SYMLINK}: {link} is a symbolic link, and the candidate copies only regular files inside the project"),
            )
            .located(link.clone(), 1, 1),
        );
    }
    // 0.8 applied its config and theme.json to the Space, and a manifest never records them, so
    // the candidate can't tell whether they are the published ones.
    let config = super::CONFIG_FILES.iter().chain(&[THEME_JSON, "spacefast.config.ts"]);
    for file in config.filter(|f| !verified.contains(**f)) {
        let path = root.join(file);
        if fs.is_file(&path) && !fs.is_symlink(&path) {
            errors.push(
                fail(
                    &at(file),
                    format!("{UNVERIFIED}: {file} is not in the finalize manifest, so the candidate can't check it is the published config"),
                )
                .located(file.to_string(), 1, 1),
            );
        }
    }
    for file in tree.files.iter().map(name).filter(|n| !verified.contains(n)) {
        // Unrecorded source was not part of the publish; unrecorded content may have been.
        let first = file.split('/').next().unwrap_or("");
        let content = RULE_FILES.contains(&file.as_str()) || first == "public" || served(&file);
        if SOURCE_ROOTS.contains(&first) || !content {
            continue;
        }
        errors.push(
            fail(
                &at(&file),
                format!("{UNVERIFIED}: {file} is not in the finalize manifest, so the candidate can't check it is the published file"),
            )
            .located(file.clone(), 1, 1),
        );
    }
}

/// The candidate's omissions. `converted_pages` lists the page files that converted or were
/// already refused (capsule paths); `client_carried` says whether `client/` was reproduced, as the
/// pages layout or as a converted client app (which then owns `public/`).
#[allow(clippy::too_many_arguments)]
pub(super) fn sweep(
    fs: &dyn Fs,
    root: &Path,
    config: Option<(&str, &serde_json::Value, &str)>,
    converted_pages: &[String],
    client_entry: Option<&Path>,
    client_carried: bool,
    client_app_converted: bool,
    errors: &mut Vec<Failure>,
) -> Omitted {
    let mut out = Omitted {
        files: BTreeMap::new(),
        carried: vec![],
    };
    let mut tree = Tree::default();
    walk(fs, root, root, &mut tree, false);
    let Tree { files, links, denied } = tree;
    for path in &denied {
        let name = path.to_string_lossy().replace('\\', "/");
        errors.push(
            fail(
                &format!("/{}", name.replace('~', "~0")),
                format!("{DENIED}: {name} is on the source deny list, so the candidate leaves it out"),
            )
            .located(name.clone(), 1, 1),
        );
    }
    // A link inside a source root is the converters' to refuse; anywhere else it would be served.
    for link in &links {
        let name = link.to_string_lossy().replace('\\', "/");
        let first = name.split('/').next().unwrap_or("");
        if SOURCE_ROOTS.contains(&first) && first != "pages" {
            continue;
        }
        errors.push(
            fail(
                &format!("/{}", name.replace('~', "~0")),
                format!("{SYMLINK}: {name} is a symbolic link, and the candidate copies only regular files inside the project"),
            )
            .located(name.clone(), 1, 1),
        );
    }
    let mut client_reported = false;
    // 0.8 built a client with no pages as the whole site and generated its index.html, shadowing
    // the author's (zero-compile's `standaloneClient`). The client is `runtime.client` wherever it
    // lives, as the client conversion resolves it.
    let client_app = client_entry.is_some()
        && !files
            .iter()
            .any(|f| f.starts_with("pages") && f.extension().is_some_and(|e| e == "tsx" || e == "md" || e == "html"));
    let client_root = client_entry
        .and_then(|e| e.iter().next())
        .map(|c| c.to_string_lossy().into_owned())
        .filter(|c| {
            !SOURCE_ROOTS.contains(&c.as_str()) && client_entry.is_some_and(|e| e.parent() != Some(Path::new("")))
        });
    for relative in files {
        let name = relative.to_string_lossy().replace('\\', "/");
        let at = format!("/{}", name.replace('~', "~0"));
        let first = name.split('/').next().unwrap_or("");
        let file = |e: Failure| e.located(name.clone(), 1, 1);
        // The client app's own directory (runtime.client outside client/), and its entry file.
        let in_client =
            first == "client" || client_root.as_deref() == Some(first) || client_entry.is_some_and(|e| relative == e);
        if in_client {
            // One error for the client: its files are one app, built by 0.8 into client.js.
            if !client_carried && !client_reported {
                client_reported = true;
                errors.push(fail("/client", format!("{CLIENT}: 0.8 built client/ into the Space's browser app beside its pages; only a client app without pages is converted, so publishing would remove this interface")).located(name.clone(), 1, 1));
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
        // A converted client app owns public/ and reports a clash there itself.
        if (name == "public" || name.starts_with("public/")) && client_app_converted {
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
    // 0.8 served `<name>.html` (or `.htm`) at `/<name>` unless cleanUrls was false; v2 serves files
    // as named.
    let clean_page = out.carried.iter().find(|f| {
        let base = f.rsplit('/').next().unwrap_or(f);
        (base.ends_with(".html") || base.ends_with(".htm")) && !base.starts_with("index.")
    });
    if let Some((config_file, config, text)) = config {
        // The key's line in the config file, where the fix goes.
        let line_of = |key: &str| -> (usize, usize) {
            let needle = format!("\"{key}\"");
            text.lines()
                .enumerate()
                .find_map(|(i, l)| l.find(&needle).map(|c| (i + 1, l[..c].encode_utf16().count() + 1)))
                .unwrap_or((1, 1))
        };
        // Fail closed: every key 0.8 applied is refused unless it is known to change nothing.
        for key in config.as_object().into_iter().flat_map(|o| o.keys()) {
            if NO_OP_KEYS.contains(&key.as_str()) {
                continue;
            }
            let reason = SERVING_KEYS
                .iter()
                .find(|(k, _)| k == key)
                .map_or(CONFIG, |(_, reason)| reason);
            let (line, column) = line_of(key);
            errors.push(
                fail(
                    &pointer(&format!("/{config_file}"), key),
                    format!("{reason}: 0.8 applied {config_file} `{key}` to the Space"),
                )
                .located(config_file.to_string(), line, column),
            );
        }
        if let Some(page) = clean_page
            && config.get("cleanUrls").is_none()
        {
            errors.push(
                fail(
                    &pointer(&format!("/{config_file}"), "cleanUrls"),
                    format!("{CLEAN_URLS}: 0.8 served each <name>.html at /<name> by default, {page} included"),
                )
                .located(config_file.to_string(), 1, 1),
            );
        }
    } else if let Some(page) = clean_page {
        errors.push(
            fail(
                "/cleanUrls",
                format!("{CLEAN_URLS}: 0.8 served each <name>.html at /<name> by default, {page} included"),
            )
            .located(page.clone(), 1, 1),
        );
    }
    // 0.8 inferred the pages' theme tokens from theme.json and linked the generated theme.css.
    if fs.is_file(&root.join(THEME_JSON)) {
        errors.push(
            fail(
                &format!("/{THEME_JSON}"),
                format!("{CONFIG}: 0.8 turned {THEME_JSON} into the Space's generated theme.css"),
            )
            .located(THEME_JSON.to_string(), 1, 1),
        );
    }
    out
}
