//! `first/app/` route files become compiled roots (docs/spec/rendering.md §2–§3).
//!
//! Each file's exports are checked against what its name allows ([`crate::app::allowed_exports`]):
//! - `default`: the page, layout, not-found or error component, compiled like any component;
//! - `metadata`: a literal object (title, description, robots, canonical) or a function of the
//!   page's props returning one;
//! - `guard` (layouts): a role name, `false`, or a function of `{ user }` returning a boolean;
//! - `search` (pages): an object of field builders, parsed from the query string and passed to the
//!   page as `search`;
//! - `GET`/`POST`/... (pages and `route.ts`): HTTP handlers, `(req, ctx) => { status, headers, body }`,
//!   as `routes` handlers are.
//!
//! The route table itself goes into `schema.php` as `app`, which `First\Wp\AppRouter` reads.

use crate::app::{self, RouteKind};
use crate::diag::{Diag, Span};
use crate::extract::{self, Root, Slot};
use crate::schema::{AppFile, AppRoute, AppSearch, Schema};
use crate::value::Value;
use crate::{eval, loader};

fn at(program: &loader::Program, module: usize) -> Span {
    Span {
        file: program.modules[module].file,
        start: 0,
        end: 0,
    }
}

/// The compiled-function name stem for a route file: `app/blog/[slug]/page.tsx` → `app__blog__slug__page`.
fn stem(file: &str) -> String {
    let mut out = String::new();
    for c in file.trim_end_matches(".tsx").trim_end_matches(".ts").chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    out.trim_matches('_').to_string()
}

pub fn register(program: &loader::Program, ev: &mut eval::Evaluator, ext: &mut extract::Extracted) -> Result<(), Diag> {
    if program.app.routes.is_empty() && program.app.not_found.is_none() {
        return Ok(());
    }
    let mut files = indexmap::IndexMap::new();
    for (path, module) in &program.app_files {
        let span = at(program, *module);
        let exports = ev.run_module(*module)?;
        let allowed = app::allowed_exports(path);
        for name in exports.keys() {
            if !allowed.contains(&name.as_str()) {
                let help = if name.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
                    "move components into first/components/ (or a `_private` folder) and import them".to_string()
                } else {
                    format!(
                        "{path} exports only {}; move helpers into a module it imports",
                        allowed.join(", ")
                    )
                };
                return Err(Diag::new(span, format!("{path} can't export `{name}`")).help(help));
            }
        }
        let stem = stem(path);
        let mut file = AppFile::default();
        let handler = path.ends_with("route.ts");
        match exports.get("default") {
            Some(Value::Closure(c)) if !handler => {
                file.component = Some(String::new());
                ext.roots.push(Root {
                    closure: c.clone(),
                    slot: Slot::AppPage { file: path.clone() },
                    name: format!("{stem}__default"),
                    plugin: None,
                });
            }
            Some(other) if !handler => {
                return Err(Diag::new(
                    span,
                    format!("{path}'s default export is {}, not a component", other.describe()),
                )
                .help("write `export default function Page(props) { return <main>…</main>; }`"));
            }
            None if !handler => {
                return Err(Diag::new(span, format!("{path} needs a default-exported component"))
                    .help("write `export default function Page() { return <main>…</main>; }`"));
            }
            _ => {}
        }
        if let Some(meta) = exports.get("metadata") {
            match meta {
                Value::Closure(c) => {
                    file.metadata = Some(serde_json::Value::Null);
                    ext.roots.push(Root {
                        closure: c.clone(),
                        slot: Slot::AppMetadata { file: path.clone() },
                        name: format!("{stem}__metadata"),
                        plugin: None,
                    });
                }
                Value::Object(_) => file.metadata = Some(metadata_literal(meta, span)?),
                other => {
                    return Err(
                        Diag::new(span, format!("`metadata` is {}, not an object", other.describe()))
                            .help("export `const metadata = { title: \"…\" }`, or a function of the page props"),
                    );
                }
            }
        }
        if let Some(guard) = exports.get("guard") {
            file.guard = Some(match guard {
                Value::Str(s)
                    if s.as_ref() == "anyone"
                        || s.as_ref() == "authenticated"
                        || crate::schema::ROLES.contains(&s.as_ref()) =>
                {
                    crate::schema::Access::Role(s.to_string())
                }
                Value::Bool(b) => crate::schema::Access::Allow(*b),
                Value::Closure(c) => {
                    ext.roots.push(Root {
                        closure: c.clone(),
                        slot: Slot::AppGuard { file: path.clone() },
                        name: format!("{stem}__guard"),
                        plugin: None,
                    });
                    crate::schema::Access::Fn(String::new())
                }
                other => {
                    return Err(Diag::new(span, format!("`guard` is {}, not a role or a function", other.describe()))
                        .help("use a role (\"subscriber\", \"author\", \"editor\", \"admin\", \"authenticated\") or `({ user }) => boolean`"));
                }
            });
        }
        if let Some(search) = exports.get("search") {
            file.search = Some(search_fields(search, span, ev, ext)?);
        }
        for method in app::METHODS {
            match exports.get(*method) {
                Some(Value::Closure(c)) => {
                    file.methods.insert(method.to_string(), String::new());
                    ext.roots.push(Root {
                        closure: c.clone(),
                        slot: Slot::AppHandler {
                            file: path.clone(),
                            method: method.to_string(),
                        },
                        name: format!("{stem}__{}", method.to_ascii_lowercase()),
                        plugin: None,
                    });
                }
                Some(other) => {
                    return Err(
                        Diag::new(span, format!("`{method}` is {}, not a handler", other.describe())).help(format!(
                            "write `export async function {method}(req) {{ return {{ status: 200, body: \"…\" }}; }}`"
                        )),
                    );
                }
                None => {}
            }
        }
        if handler && file.methods.is_empty() {
            return Err(Diag::new(span, format!("{path} exports no HTTP handler"))
                .help("export `GET`, `POST`, `PUT`, `PATCH` or `DELETE`"));
        }
        // Who may call the handlers: said explicitly, as a route is public only when it says so.
        // A signed webhook proves its sender with an HMAC over the raw body and runs as the system.
        match (exports.get("access"), exports.get("signature")) {
            (Some(_), Some(_)) => {
                return Err(Diag::new(span, format!("{path} exports both `access` and `signature`"))
                    .help("keep `signature` for a signed webhook (it authenticates the caller), or `access` for everyone else"));
            }
            (None, Some(s)) => file.signature = Some(extract::signature_config(s, span, ev.legacy())?),
            (Some(a), None) => {
                file.access = Some(match a {
                    Value::Str(s)
                        if s.as_ref() == "anyone"
                            || s.as_ref() == "authenticated"
                            || crate::schema::ROLES.contains(&s.as_ref()) =>
                    {
                        crate::schema::Access::Role(s.to_string())
                    }
                    Value::Bool(b) => crate::schema::Access::Allow(*b),
                    Value::Closure(c) => {
                        ext.roots.push(Root {
                            closure: c.clone(),
                            slot: Slot::AppAccess { file: path.clone() },
                            name: format!("{stem}__access"),
                            plugin: None,
                        });
                        crate::schema::Access::Fn(String::new())
                    }
                    other => {
                        return Err(Diag::new(
                            span,
                            format!("`access` is {}, not a role or a function", other.describe()),
                        )
                        .help("use \"anyone\", \"authenticated\", a role, or `({ user }) => boolean`"));
                    }
                });
            }
            (None, None) if !file.methods.is_empty() => {
                return Err(Diag::new(span, format!("{path} has HTTP handlers but no `access`"))
                    .help("say who may call them: `export const access = \"anyone\"` (or a role), or `export const signature = { secret: env(\"…\"), header, scheme }` for a signed webhook"));
            }
            (None, None) => {}
        }
        if (exports.contains_key("access") || exports.contains_key("signature")) && file.methods.is_empty() {
            return Err(Diag::new(span, format!("{path} exports `access` or `signature` but no HTTP handler"))
                .help("they govern `GET`/`POST`/… handlers; a page's own readers are decided by its reads and its layouts' `guard`"));
        }
        files.insert(path.clone(), file);
    }
    let kinds: Vec<(String, String)> = ext
        .schema
        .collections
        .iter()
        .filter_map(|(name, c)| c.url.clone().map(|u| (name.clone(), u)))
        .collect();
    // A page's stylesheets: what its layouts (root first) and the page itself import.
    let module_of = |file: &str| program.app_files.iter().find(|(p, _)| p == file).map(|(_, m)| *m);
    let route = |r: &app::Route| AppRoute {
        styles: crate::assets::stylesheets(
            program,
            &r.layouts
                .iter()
                .chain((r.kind == RouteKind::Page).then_some(&r.file))
                .filter_map(|f| module_of(f))
                .collect::<Vec<_>>(),
        ),
        id: r.id(),
        pattern: r.pattern(),
        page: (r.kind == RouteKind::Page).then(|| r.file.clone()),
        handler: (r.kind == RouteKind::Handler).then(|| r.file.clone()),
        layouts: r.layouts.clone(),
        error: r.error.clone(),
        kind: (r.kind == RouteKind::Page)
            .then(|| {
                kinds
                    .iter()
                    .find_map(|(k, u)| app::serves_kind_url(r, u).map(|b| (k.clone(), b)))
            })
            .flatten(),
    };
    for asset in program.assets.values() {
        ext.schema.assets.insert(asset.file.clone(), asset.bytes.clone());
    }
    ext.schema.app = Some(crate::schema::App {
        routes: program.app.routes.iter().map(route).collect(),
        not_found: program.app.not_found.as_ref().map(route),
        files,
        content: indexmap::IndexMap::new(),
        legacy_routes: false,
    });
    Ok(())
}

/// A literal `metadata` object, checked: strings for `title`, `description`, `canonical`, and a
/// layout's `title: { default, template }`; `robots: { index, follow }` booleans.
fn metadata_literal(v: &Value, span: Span) -> Result<serde_json::Value, Diag> {
    let Value::Object(o) = v else { unreachable!() };
    let mut out = serde_json::Map::new();
    for (k, v) in o.borrow().iter() {
        let bad = |what: &str| {
            Diag::new(span, format!("`metadata.{k}` must be {what}"))
                .help("metadata takes title, description, canonical and robots: { index, follow }")
        };
        let value = match (k.as_str(), v) {
            (_, Value::Undef) => continue,
            ("title" | "description" | "canonical", Value::Str(s)) => serde_json::Value::String(s.to_string()),
            ("title", Value::Object(t)) => {
                let t = t.borrow();
                let get = |n: &str| match t.get(n) {
                    Some(Value::Str(s)) => Some(s.to_string()),
                    _ => None,
                };
                match (get("default"), get("template")) {
                    (Some(d), Some(tpl)) if tpl.contains("%s") && t.len() == 2 => {
                        serde_json::json!({ "default": d, "template": tpl })
                    }
                    _ => return Err(bad("a string, or { default, template } with `%s` in the template")),
                }
            }
            ("robots", Value::Object(r)) => {
                let mut robots = serde_json::Map::new();
                for (rk, rv) in r.borrow().iter() {
                    match (rk.as_str(), rv) {
                        ("index" | "follow", Value::Bool(b)) => {
                            robots.insert(rk.clone(), serde_json::Value::Bool(*b));
                        }
                        _ => return Err(bad("{ index?: boolean, follow?: boolean }")),
                    }
                }
                serde_json::Value::Object(robots)
            }
            ("title" | "description" | "canonical", _) => return Err(bad("a string")),
            ("robots", _) => return Err(bad("{ index?: boolean, follow?: boolean }")),
            _ => {
                return Err(Diag::new(span, format!("`metadata` has no field `{k}`"))
                    .help("metadata takes title, description, canonical and robots"));
            }
        };
        out.insert(k.clone(), value);
    }
    Ok(serde_json::Value::Object(out))
}

/// `export const search = { page: integer().default(1), q: text().optional() }`: query-string
/// fields, parsed and typed like action input (rendering.md §1, typed search params).
fn search_fields(
    v: &Value,
    span: Span,
    ev: &mut eval::Evaluator,
    ext: &mut extract::Extracted,
) -> Result<AppSearch, Diag> {
    let Value::Object(fields) = v else {
        return Err(Diag::new(span, "`search` must be an object of fields")
            .help("write `export const search = { page: integer().default(1), q: text() }`"));
    };
    let mut out = indexmap::IndexMap::new();
    for (name, f) in fields.borrow().iter() {
        let Value::Column(b) = f else {
            return Err(
                Diag::new(span, format!("search field `{name}` is {}, not a field", f.describe()))
                    .help("describe search params with integer(), text(), boolean(), select([...])"),
            );
        };
        let col = extract::input_column(name, b, ev, ext)?;
        if !matches!(
            col.ty,
            crate::schema::ColType::Integer
                | crate::schema::ColType::Real
                | crate::schema::ColType::Text
                | crate::schema::ColType::Boolean
                | crate::schema::ColType::Date
                | crate::schema::ColType::Slug
        ) {
            return Err(Diag::new(
                b.span,
                format!(
                    "search field `{name}` is {}, which a query string can't carry",
                    col.ty.name()
                ),
            )
            .help("use integer(), number(), text(), boolean(), date() or select([...])"));
        }
        out.insert(name.clone(), col);
    }
    Ok(AppSearch { fields: out })
}

/// Fills the compiled function names into the route table once the roots are compiled.
pub fn fill(schema: &mut Schema, slot: &Slot, name: &str) -> bool {
    let Some(app) = schema.app.as_mut() else { return false };
    match slot {
        Slot::AppPage { file } => {
            app.files.get_mut(file).expect("app file").component = Some(name.to_string());
            true
        }
        Slot::AppMetadata { file } => {
            app.files.get_mut(file).expect("app file").metadata = Some(serde_json::json!({ "fn": name }));
            true
        }
        Slot::AppAccess { file } => {
            app.files.get_mut(file).expect("app file").access = Some(crate::schema::Access::Fn(name.to_string()));
            true
        }
        Slot::AppGuard { file } => {
            app.files.get_mut(file).expect("app file").guard = Some(crate::schema::Access::Fn(name.to_string()));
            true
        }
        Slot::AppHandler { file, method } => {
            app.files
                .get_mut(file)
                .expect("app file")
                .methods
                .insert(method.clone(), name.to_string());
            true
        }
        _ => false,
    }
}
