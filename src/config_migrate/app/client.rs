//! A 0.8 client app without pages becomes static files in the candidate's `public/`.
//!
//! 0.8 served such a capsule as a single-page app: its compiler bundled `client/index.tsx`, mounted
//! the exported `App` into `#root`, and resolved `@spacefast/zero/client`, Preact and the React
//! names through an import map. v2 publishes `public/` as it is, so the converter does the same
//! work once, ahead of time:
//!
//! - every module the client entry reaches is compiled from TypeScript/TSX to a browser module
//!   under `public/app/`, with JSX on Preact's automatic runtime;
//! - `@spacefast/zero/client` (and its `lakebed` aliases) resolve to `public/zero/client.js`, a
//!   compatibility module that runs each 0.8 query, mutation and action as the v2 action the
//!   converter generated for it, at `/wp-json/zero/v1/actions/<name>`;
//! - `preact`, `react` and `react-dom` resolve to a vendored Preact under `public/zero/preact/`;
//! - `public/index.html` and `public/zero/main.js` mount `App` as 0.8 did.
//!
//! Nothing here changes a deployed 0.8 Space: only the converted v2 candidate carries the bridge.
//! Anything the client needs that has no v2 counterpart is refused with a coded diagnostic.
use super::super::{Diagnostic, Entry, Failure, entry, refuse};
use crate::loader::Fs;
use oxc_allocator::Allocator;
use oxc_ast::ast::{ImportDeclarationSpecifier, ModuleExportName, Statement, Str};
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_transformer::{JsxOptions, JsxRuntime, TransformOptions, Transformer};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// The compatibility module and the Preact build it runs on, written under `public/zero/`.
const RUNTIME: &[(&str, &str)] = &[
    ("client.js", include_str!("client08/zero-client.js")),
    ("preact/preact.js", include_str!("client08/preact/preact.js")),
    ("preact/hooks.js", include_str!("client08/preact/hooks.js")),
    ("preact/jsx-runtime.js", include_str!("client08/preact/jsx-runtime.js")),
    ("preact/compat.js", include_str!("client08/preact/compat.js")),
    (
        "preact/compat-client.js",
        include_str!("client08/preact/compat-client.js"),
    ),
    ("preact/LICENSE", include_str!("client08/preact/LICENSE")),
];

/// What the 0.8 import map answered, and where the candidate answers it (under `public/`).
fn platform(spec: &str) -> Option<&'static str> {
    Some(match spec {
        "@spacefast/zero/client" | "lakebed/client" | "@spacefast/compat-lakebed/client" => "zero/client.js",
        "preact" => "zero/preact/preact.js",
        "preact/hooks" => "zero/preact/hooks.js",
        "preact/jsx-runtime" | "preact/jsx-dev-runtime" | "react/jsx-runtime" | "react/jsx-dev-runtime" => {
            "zero/preact/jsx-runtime.js"
        }
        "preact/compat" | "react" | "react-dom" | "react-is" => "zero/preact/compat.js",
        "preact/compat/client" | "react-dom/client" => "zero/preact/compat-client.js",
        _ => return None,
    })
}

/// The 0.8 client names the compatibility module provides.
const BRIDGED: &[&str] = &[
    "useQuery",
    "useMutation",
    "useAction",
    "usePaginatedQuery",
    "queryOptions",
    "createClient",
    "useAuth",
    "signOut",
    "Router",
    "Routes",
    "Route",
    "Link",
    "navigate",
    "useLocation",
    "useNavigate",
    "useParams",
];

/// A refused 0.8 client name: its code, what it was, what v2 has, and the fix.
fn unbridged(name: &str) -> (&'static str, &'static str, &'static str) {
    match name {
        "storage" => (
            "Z08_CLIENT_STORAGE",
            "the client storage uploads",
            "v2 file buckets (`files` in zero.config.ts, `client.files.<bucket>.upload`)",
        ),
        "authenticatedFetch" => (
            "Z08_CLIENT_FETCH",
            "authenticatedFetch",
            "a v2 action or route called with the session's bearer token",
        ),
        "useConnectorState" | "useConnectorRoleState" | "retryConnectorQueries" => (
            "Z08_CLIENT_CONNECTORS",
            "connector state",
            "nothing yet: connector calls are not in v2",
        ),
        "contentQueryOptions" => (
            "Z08_CLIENT_CONTENT",
            "content reads from the client",
            "a v2 collection read (`client.<collection>.list`)",
        ),
        "SignInWithGoogle"
        | "SignInWithGravatar"
        | "SignInWithSpacefast"
        | "signInWithGoogle"
        | "signInWithGravatar"
        | "signInWithSpacefast"
        | "getIdentity"
        | "getCurrentUser"
        | "retryAuth"
        | "canAccessApp" => (
            "Z08_CLIENT_SIGN_IN",
            "0.8 sign-in",
            "zero-identity sign-in (`client.auth.signIn()` from the generated v2 client)",
        ),
        _ => (
            "Z08_CLIENT_API",
            "a 0.8 client API with no v2 counterpart",
            "the generated v2 client in zero/client/",
        ),
    }
}

/// Converted client files (paths under the candidate root) and the client's entries.
pub(super) struct Converted {
    pub files: BTreeMap<String, String>,
}

/// `(line, column)`, both 1-based, of byte `offset` in `text`; columns count UTF-16 units.
fn position(text: &str, offset: u32) -> (u32, u32) {
    let before = &text[..(offset as usize).min(text.len())];
    let line = before.matches('\n').count() as u32 + 1;
    let start = before.rfind('\n').map_or(0, |i| i + 1);
    (line, before[start..].encode_utf16().count() as u32 + 1)
}

struct Walk<'f> {
    fs: &'f dyn Fs,
    root: &'f Path,
    errors: Vec<Failure>,
    out: BTreeMap<String, String>,
    seen: BTreeSet<PathBuf>,
}

impl Walk<'_> {
    fn refuse(
        &mut self,
        file: &Path,
        text: &str,
        offset: u32,
        code: &'static str,
        feature: String,
        v2: &str,
        fix: String,
    ) {
        let file = file.to_string_lossy().replace('\\', "/");
        let (line, column) = position(text, offset);
        let at = super::pages::at(Path::new(&file));
        self.errors.push(refuse(
            &at,
            Diagnostic {
                code,
                file,
                line,
                column,
                feature,
                v2: v2.into(),
                fix,
            },
        ));
    }

    /// The capsule file a relative import names, trying 0.8's resolution order.
    fn resolve(&self, from: &Path, spec: &str) -> Option<PathBuf> {
        let base = from.parent().unwrap_or(Path::new("")).join(spec);
        let base = normalize(&base)?;
        let candidates = [
            base.clone(),
            base.with_extension("tsx"),
            base.with_extension("ts"),
            base.with_extension("jsx"),
            base.with_extension("js"),
            base.join("index.tsx"),
            base.join("index.ts"),
            base.join("index.js"),
        ];
        candidates
            .into_iter()
            .find(|c| !c.as_os_str().is_empty() && self.fs.is_file(&self.root.join(c)))
    }

    /// Compiles `relative` and every module it reaches; returns its path under `public/`.
    fn module(&mut self, relative: &Path) -> String {
        let target = format!("app/{}", js_name(relative));
        if !self.seen.insert(relative.to_path_buf()) {
            return target;
        }
        let at = super::pages::at(relative);
        let text = match self.fs.read_to_string(&self.root.join(relative)) {
            Ok(t) => t,
            Err(e) => {
                self.errors
                    .push(super::super::fail(&at, format!("cannot read the client module: {e}")));
                return target;
            }
        };
        let ext = relative.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext == "css" {
            // A CSS import is a stylesheet the 0.8 bundler injected; the shell links it instead.
            self.out.insert(format!("public/{}", relative.to_string_lossy()), text);
            return target;
        }
        let source_type = match ext {
            "tsx" => SourceType::tsx(),
            "ts" => SourceType::ts(),
            "jsx" => SourceType::jsx(),
            "js" | "mjs" => SourceType::mjs(),
            _ => {
                self.refuse(
                    relative,
                    &text,
                    0,
                    "Z08_CLIENT_ASSET",
                    format!("a client import of a .{ext} file"),
                    "static files in public/",
                    "move the file into public/ and reference it by URL".into(),
                );
                return target;
            }
        };
        let arena = Allocator::default();
        let parsed = Parser::new(&arena, &text, source_type).parse();
        if let Some(e) = parsed.diagnostics.errors().next() {
            let offset = e.labels.first().map_or(0, |l| l.offset() as u32);
            self.refuse(
                relative,
                &text,
                offset,
                "Z08_CLIENT_SYNTAX",
                format!("client source that does not parse ({e})"),
                "a browser module",
                "fix the syntax error in the 0.8 source and convert again".into(),
            );
            return target;
        }
        let mut program = parsed.program;
        for import in &parsed.module_record.dynamic_imports {
            self.refuse(
                relative,
                &text,
                import.span.start,
                "Z08_CLIENT_DYNAMIC_IMPORT",
                "a dynamic import() in the client".into(),
                "static imports",
                "import the module statically".into(),
            );
        }
        // Resolve every specifier first, then rewrite the AST with the answers.
        let depth = target.matches('/').count();
        let up = "../".repeat(depth);
        let mut rewrites: BTreeMap<String, String> = BTreeMap::new();
        let mut follow = vec![];
        let mut sources = vec![];
        for stmt in &program.body {
            let (source, offset, names): (&str, u32, Vec<String>) = match stmt {
                Statement::ImportDeclaration(d) => {
                    if d.import_kind.is_type() {
                        continue;
                    }
                    let names = d
                        .specifiers
                        .iter()
                        .flatten()
                        .filter_map(|s| match s {
                            ImportDeclarationSpecifier::ImportSpecifier(x) if !x.import_kind.is_type() => {
                                Some(export_name(&x.imported))
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => Some("*".into()),
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => Some("default".into()),
                            _ => None,
                        })
                        .collect();
                    (d.source.value.as_str(), d.source.span.start, names)
                }
                Statement::ExportFromDeclaration(d) if !d.export_kind.is_type() => {
                    let names = d.specifiers.iter().map(|x| export_name(&x.local)).collect();
                    (d.source.value.as_str(), d.source.span.start, names)
                }
                Statement::ExportAllDeclaration(d) if !d.export_kind.is_type() => {
                    (d.source.value.as_str(), d.source.span.start, vec!["*".into()])
                }
                _ => continue,
            };
            sources.push((source.to_string(), offset, names));
        }
        for (source, offset, names) in sources {
            if let Some(path) = platform(&source) {
                if path == "zero/client.js" {
                    for name in &names {
                        if name == "*" || !BRIDGED.contains(&name.as_str()) {
                            let (code, feature, v2) = unbridged(name);
                            self.refuse(
                                relative,
                                &text,
                                offset,
                                code,
                                format!("{feature} (`{name}` from {source})"),
                                v2,
                                format!("replace `{name}` with {v2} in a hand port"),
                            );
                        }
                    }
                }
                rewrites.insert(source, format!("{up}{path}"));
            } else if source.starts_with('.') {
                match self.resolve(relative, &source) {
                    Some(file) => {
                        let module = format!("app/{}", js_name(&file));
                        rewrites.insert(source, relative_url(&target, &module));
                        follow.push(file);
                    }
                    None => self.refuse(
                        relative,
                        &text,
                        offset,
                        "Z08_CLIENT_IMPORT",
                        format!("an import of {source}, which is not in the capsule"),
                        "modules inside the capsule",
                        "add the module to the capsule or remove the import".into(),
                    ),
                }
            } else {
                let (code, feature, v2, fix) = match source.as_str() {
                    s if s.starts_with("@spacefast/zero/kit") => (
                        "Z08_CLIENT_KIT",
                        "the 0.8 kit components",
                        "plain markup and CSS",
                        "replace the kit components with your own markup and styles",
                    ),
                    s if s.starts_with("@spacefast/zero/charts") || s == "recharts" => (
                        "Z08_CLIENT_CHARTS",
                        "0.8 charts",
                        "nothing yet: charts are not in v2",
                        "draw the chart with your own SVG or a library you vendor into public/",
                    ),
                    s if s.starts_with("@spacefast/zero/") => (
                        "Z08_CLIENT_API",
                        "a 0.8 client module",
                        "the generated v2 client in zero/client/",
                        "port the calls to the generated v2 client",
                    ),
                    _ => (
                        "Z08_CLIENT_PACKAGE",
                        "an npm package in the client",
                        "a prebuilt browser bundle in public/",
                        "build the client with its packages (for example with Vite into public/) and publish that",
                    ),
                };
                self.refuse(
                    relative,
                    &text,
                    offset,
                    code,
                    format!("{feature} ({source})"),
                    v2,
                    fix.into(),
                );
            }
        }
        // A stylesheet import was the 0.8 bundler's to inject; the shell links the file instead.
        program
            .body
            .retain(|s| !matches!(s, Statement::ImportDeclaration(d) if d.source.value.ends_with(".css")));
        for stmt in program.body.iter_mut() {
            let source = match stmt {
                Statement::ImportDeclaration(d) => Some(&mut d.source),
                Statement::ExportFromDeclaration(d) => Some(&mut d.source),
                Statement::ExportAllDeclaration(d) => Some(&mut d.source),
                _ => None,
            };
            if let Some(source) = source
                && let Some(to) = rewrites.get(source.value.as_str())
            {
                source.value = Str::from(arena.alloc_str(to));
                source.raw = None;
            }
        }
        let semantic = SemanticBuilder::new().build(&program);
        let options = TransformOptions {
            jsx: JsxOptions {
                runtime: JsxRuntime::Automatic,
                // `jsxImportSource` + `/jsx-runtime` is the import the transform adds; 0.8 used Preact's.
                import_source: Some("preact".into()),
                ..JsxOptions::enable()
            },
            ..TransformOptions::default()
        };
        let transformed = Transformer::new(&arena, relative, &options)
            .build_with_scoping(semantic.semantic.into_scoping(), &mut program);
        if let Some(e) = transformed.diagnostics.first() {
            let offset = e.labels.first().map_or(0, |l| l.offset() as u32);
            self.refuse(
                relative,
                &text,
                offset,
                "Z08_CLIENT_SYNTAX",
                format!("client source the browser build cannot compile ({e})"),
                "a browser module",
                "rewrite the construct in plain TypeScript".into(),
            );
            return target;
        }
        // The JSX transform's own import, added after the rewrite above.
        let jsx = format!("{up}zero/preact/jsx-runtime.js");
        let code = Codegen::new()
            .build(&program)
            .code
            .replace("from \"preact/jsx-runtime\"", &format!("from \"{jsx}\""));
        self.out.insert(format!("public/{target}"), code);
        for file in follow {
            self.module(&file);
        }
        target
    }
}

fn export_name(name: &ModuleExportName) -> String {
    match name {
        ModuleExportName::IdentifierName(n) => n.name.to_string(),
        ModuleExportName::IdentifierReference(n) => n.name.to_string(),
        ModuleExportName::StringLiteral(s) => s.value.to_string(),
    }
}

/// `client/App.tsx` → `client/App.js`.
fn js_name(path: &Path) -> String {
    path.with_extension("js").to_string_lossy().replace('\\', "/")
}

/// The URL from module `from` to module `to`, both relative to `public/`.
fn relative_url(from: &str, to: &str) -> String {
    let from: Vec<&str> = from.split('/').collect();
    let to: Vec<&str> = to.split('/').collect();
    let dirs = &from[..from.len() - 1];
    let common = dirs.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let mut out = "../".repeat(dirs.len() - common);
    if out.is_empty() {
        out.push_str("./");
    }
    out.push_str(&to[common..].join("/"));
    out
}

/// Resolves `a/../b` without touching the filesystem; `None` when it climbs out of the capsule.
fn normalize(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            std::path::Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            std::path::Component::Normal(p) => out.push(p),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

/// The shell 0.8 generated around the client, with the bundle's stylesheets.
fn shell(title: &str, styles: &[String]) -> String {
    let title = title.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let links: String = styles
        .iter()
        .map(|s| format!("    <link rel=\"stylesheet\" href=\"./{s}\">\n"))
        .collect();
    format!(
        "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n    <title>{title}</title>\n{links}  </head>\n  <body>\n    <div id=\"root\"></div>\n    <script type=\"module\" src=\"./zero/main.js\"></script>\n  </body>\n</html>\n"
    )
}

/// `{ name: { inputs, rest } }` for the compatibility module.
fn handlers(handlers: &[(String, Vec<String>, bool)]) -> String {
    let map: serde_json::Map<String, serde_json::Value> = handlers
        .iter()
        .map(|(name, inputs, rest)| (name.clone(), serde_json::json!({ "inputs": inputs, "rest": rest })))
        .collect();
    format!(
        "// Generated by zero migrate app: each 0.8 handler's v2 input names, in positional order.\nexport default {};\n",
        serde_json::to_string_pretty(&map).expect("handlers JSON")
    )
}

/// Converts the client app at `entry` (capsule-relative). Errors are coded refusals.
pub(super) fn convert(
    fs: &dyn Fs,
    root: &Path,
    entry_file: &Path,
    title: &str,
    converted: &[(String, Vec<String>, bool)],
    entries: &mut Vec<Entry>,
    errors: &mut Vec<Failure>,
) -> Converted {
    let mut walk = Walk {
        fs,
        root,
        errors: vec![],
        out: BTreeMap::new(),
        seen: BTreeSet::new(),
    };
    let module = walk.module(entry_file);
    let main = format!(
        "// Mounts the converted 0.8 client app as 0.8 did: its App (or default export) in #root.\nimport {{ h, render }} from \"./preact/preact.js\";\nimport * as Client from \"../{module}\";\n\nconst App = Client.App ?? Client.default;\nif (!App) throw new Error(\"The client entry must export App.\");\nrender(h(App, {{}}), document.getElementById(\"root\"));\n"
    );
    let styles: Vec<String> = walk
        .out
        .keys()
        .filter(|k| k.ends_with(".css"))
        .map(|k| k.trim_start_matches("public/").to_string())
        .collect();
    let mut files = walk.out;
    for (path, text) in RUNTIME {
        files.insert(format!("public/zero/{path}"), (*text).to_string());
    }
    files.insert("public/zero/handlers.js".into(), handlers(converted));
    files.insert("public/zero/main.js".into(), main);
    files.insert("public/index.html".into(), shell(title, &styles));
    if walk.errors.is_empty() {
        let at = super::pages::at(entry_file);
        entries.push(entry(
            &at,
            "mapped",
            format!(
                "the 0.8 client app becomes static files in public/ ({} module(s) compiled); public/zero/client.js answers @spacefast/zero/client by calling each query, mutation and action at /wp-json/zero/v1/actions/<name>",
                walk.seen.len()
            ),
        ));
        entries.push(entry(
            &at,
            "review",
            "reads refresh after this browser's own writes and on focus, not on other visitors' writes; visitors get a v2 guest session on the first write that needs one. Open public/index.html on the candidate and check each screen before cutover",
        ));
    }
    errors.extend(walk.errors);
    Converted { files }
}
