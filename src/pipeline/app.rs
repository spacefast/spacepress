//! `sp/app/` route files become compiled roots (docs/spec/rendering.md §2–§3).
//!
//! Each file's exports are checked against what its name allows ([`crate::app::allowed_exports`]):
//! - `default`: the page, layout, not-found or error component, compiled like any component;
//! - `metadata`: a literal object (title, description, robots, canonical) or a function of the
//!   page's props returning one;
//! - `guard`: page and layout read access, and the default authorization for HTTP handlers;
//! - `search` (pages): an object of field builders, parsed from the query string and passed to the
//!   page as `search`;
//! - `GET`/`POST`/... (pages and `route.ts`): HTTP handlers, `(req, ctx) => { status, headers, body }`,
//!   as `routes` handlers are.
//!
//! The route table itself goes into `schema.php` as `app`, which `SpacePress\Wp\AppRouter` reads.

use crate::app::{self, RouteKind};
use crate::diag::{Diag, Span};
use crate::extract::{self, Root, Slot};
use crate::schema::{Access, AppFile, AppRoute, AppSearch, Output, Schema};
use crate::value::Value;
use crate::{eval, loader};

fn at(program: &loader::Program, module: usize) -> Span {
    Span {
        file: program.modules[module].file,
        start: 0,
        end: 0,
    }
}

/// Where a module exports `name` (`export const name = …`), for a diagnostic at the export.
fn export_at(program: &loader::Program, module: usize, name: &str) -> Span {
    use crate::ir::{Pat, Stmt};
    for stmt in &program.modules[module].body {
        if let Stmt::Exported(inner) = stmt
            && let Stmt::Decl {
                pat: Pat::Id(n, span), ..
            } = inner.as_ref()
            && n == name
        {
            return *span;
        }
    }
    at(program, module)
}

/// `export const route = { id: "notes.show" }` on a page: an ID that stays when the file moves.
fn route_id(v: &Value, span: Span) -> Result<String, Diag> {
    let bad = || {
        Diag::new(span, "`route` must be `{ id: \"…\" }` with a literal id")
            .help("an id is letters, digits, `.`, `-` and `_`, e.g. `export const route = { id: \"notes.show\" }`")
    };
    let Value::Object(o) = v else { return Err(bad()) };
    let o = o.borrow();
    if o.len() != 1 {
        return Err(bad());
    }
    match o.get("id") {
        Some(Value::Str(id))
            if !id.is_empty()
                && id.len() <= 100
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) =>
        {
            Ok(id.to_string())
        }
        _ => Err(bad()),
    }
}

/// `export const template` on a page or layout: the block template the page renders in
/// (docs/pages.md "Block templates"). `"theme"` is SpacePress's template with the theme's header and
/// footer parts, `"blank"` the one with none; any other slug names a template the theme, a plugin
/// or the Site Editor provides. A layout that says nothing and places `<TemplatePart>` itself is
/// `"blank"`: it lays out the theme's parts where it wants them.
fn template(
    path: &str,
    value: Option<&Value>,
    program: &loader::Program,
    module: usize,
    span: Span,
) -> Result<Option<String>, Diag> {
    let help = "write `export const template = \"blank\"` for a page with no theme header and footer, `\"theme\"` for the theme's, or a template's slug";
    match value {
        None | Some(Value::Undef) => {
            Ok((path.ends_with("layout.tsx") && places_template_parts(program, module)).then(|| "blank".to_string()))
        }
        Some(Value::Str(s))
            if !s.is_empty()
                && s.len() <= 100
                && s.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
                && s.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_') =>
        {
            Ok(Some(s.to_string()))
        }
        Some(Value::Str(s)) => Err(Diag::new(
            export_at(program, module, "template"),
            format!("`template` is \"{s}\", which isn't a block template's slug"),
        )
        .help(help)),
        Some(other) => Err(Diag::new(
            span,
            format!("`template` is {}, not a template's slug", other.describe()),
        )
        .help(help)),
    }
}

/// Whether `path` is the outermost layout of some route: `app/layout.tsx`, or a route group's
/// (`app/(site)/layout.tsx`) when nothing above it wraps it.
pub fn is_root_layout(path: &str, table: &app::Table) -> bool {
    table
        .routes
        .iter()
        .chain(table.not_found.iter())
        .chain(table.login.iter())
        .any(|r| r.layouts.first().is_some_and(|l| l == path))
}

/// Whether a layout component returns anything besides its `children` (or a fragment of only them).
fn draws_chrome(func: &crate::ir::Func) -> bool {
    use crate::ir::{Expr, ExprKind, FnBody, JsxKind, Stmt};
    fn children_only(e: &Expr) -> bool {
        match &e.kind {
            ExprKind::Ident(n) => n == "children",
            ExprKind::Member { prop, .. } => prop == "children",
            ExprKind::Jsx(j) => matches!(j.kind, JsxKind::Fragment) && j.children.iter().all(children_only),
            ExprKind::Str(s) => s.trim().is_empty(),
            _ => false,
        }
    }
    fn returns(stmts: &[Stmt], out: &mut Vec<Expr>) {
        for s in stmts {
            match s {
                Stmt::Return(Some(e), _) => out.push(e.clone()),
                Stmt::If(_, t, e) => {
                    returns(t, out);
                    if let Some(e) = e {
                        returns(e, out);
                    }
                }
                Stmt::Block(b) => returns(b, out),
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    match &func.body {
        FnBody::Expr(e) => out.push(e.clone()),
        FnBody::Block(b) => returns(b, &mut out),
    }
    out.iter()
        .any(|e| matches!(e.kind, ExprKind::Jsx(_)) && !children_only(e))
}

/// Whether a module imports `TemplatePart` from `"spacepress/app"`.
fn places_template_parts(program: &loader::Program, module: usize) -> bool {
    use crate::ir::{ImportName, Stmt};
    program.modules[module].body.iter().any(|stmt| match stmt {
        Stmt::Import { source, specs, .. } if source == loader::APP_MODULE => specs
            .iter()
            .any(|s| matches!(&s.imported, ImportName::Named(n) if n == "TemplatePart")),
        _ => false,
    })
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

fn access_role(role: &str) -> bool {
    matches!(role, "anyone" | "authenticated") || crate::schema::ROLES.contains(&role)
}

fn guard_rule(
    rule: &Value,
    span: Span,
    path: &str,
    label: &str,
    handler: bool,
    roots: &mut Vec<Root>,
) -> Result<Access, Diag> {
    Ok(match rule {
        Value::Str(s) if access_role(s) => Access::Role(s.to_string()),
        Value::Bool(b) => Access::Allow(*b),
        Value::Closure(c) => {
            let file = path.to_string();
            let (slot, suffix) = if handler {
                (Slot::AppAccess { file }, "handler_guard")
            } else {
                (Slot::AppGuard { file }, "guard")
            };
            roots.push(Root {
                closure: c.clone(),
                slot,
                name: format!("{}__{suffix}", stem(path)),
                plugin: None,
            });
            Access::Fn(String::new())
        }
        other => {
            return Err(Diag::new(
                span,
                format!("`{label}` is {}, not a role, boolean or function", other.describe()),
            )
            .help("use \"anyone\", \"authenticated\", a role, a boolean, or `({ user }) => boolean`"));
        }
    })
}

fn register_guard(
    path: &str,
    span: Span,
    value: &Value,
    handler: bool,
    file: &mut AppFile,
    roots: &mut Vec<Root>,
) -> Result<(), Diag> {
    if handler && file.signature.is_some() {
        return Err(Diag::new(span, format!("{path} exports both `access` and `signature`"))
            .help("choose one authorization rule for the HTTP handlers"));
    }
    if let Value::Object(rules) = value {
        if handler || file.methods.is_empty() || file.signature.is_some() {
            return Err(Diag::new(
                span,
                "`access = { page, handlers }` requires a page with unsigned HTTP handlers",
            )
            .help("use a single `access` on this file"));
        }
        let rules = rules.borrow();
        if let Some((key, _)) = rules
            .iter()
            .find(|(key, _)| !matches!(key.as_str(), "page" | "handlers"))
        {
            return Err(
                Diag::new(span, format!("`access` has an unknown field `{key}`")).help("use `page` and `handlers`")
            );
        }
        let methods = rules.get("handlers").ok_or_else(|| {
            Diag::new(span, "`access = { page, handlers }` needs a `handlers` rule")
                .help("set `handlers` for the HTTP methods; omit `page` if the page is public")
        })?;
        if let Some(page) = rules.get("page").filter(|page| !matches!(page, Value::Undef)) {
            file.guard = Some(guard_rule(page, span, path, "access.page", false, roots)?);
        }
        file.handler_guard = Some(guard_rule(methods, span, path, "access.handlers", true, roots)?);
    } else {
        let rule = guard_rule(value, span, path, "access", handler, roots)?;
        if handler {
            file.handler_guard = Some(rule);
        } else {
            // A shared function fills its handler name along with its page name (see fill).
            if !file.methods.is_empty() && file.signature.is_none() && !matches!(rule, Access::Fn(_)) {
                file.handler_guard = Some(rule.clone());
            }
            file.guard = Some(rule);
        }
    }
    Ok(())
}

/// Scans all loaded modules for implicit references to built-in WordPress kinds (`posts`, `pages`,
/// `users`) on `db` / `db.system` and materializes them in `ext.schema` if not already declared.
pub fn materialize_builtins(program: &loader::Program, ext: &mut extract::Extracted) {
    use crate::ir::{ArrEl, Expr, ExprKind, FnBody, Pat, Prop, PropKey, Stmt};

    fn check_name(name: &str, out: &mut Vec<&'static str>) {
        let target = match name {
            "posts" => "posts",
            "pages" => "pages",
            "users" => "users",
            _ => return,
        };
        if !out.contains(&target) {
            out.push(target);
        }
    }

    fn is_db_expr(e: &Expr) -> bool {
        match &e.kind {
            ExprKind::Ident(n) => n == "db",
            ExprKind::Member { obj, prop, .. } => prop == "db" || (prop == "system" && is_db_expr(obj)),
            _ => false,
        }
    }

    fn walk_expr(e: &Expr, out: &mut Vec<&'static str>) {
        match &e.kind {
            ExprKind::Member { obj, prop, .. } => {
                if is_db_expr(obj) {
                    check_name(prop, out);
                }
                walk_expr(obj, out);
            }
            ExprKind::Index { obj, index, .. } => {
                walk_expr(obj, out);
                walk_expr(index, out);
            }
            ExprKind::Call { callee, args, .. } | ExprKind::New { callee, args, .. } => {
                walk_expr(callee, out);
                for a in args {
                    match a {
                        ArrEl::Item(x) | ArrEl::Spread(x) => walk_expr(x, out),
                    }
                }
            }
            ExprKind::Assign { target, value, .. } => {
                walk_expr(target, out);
                walk_expr(value, out);
            }
            ExprKind::Binary(_, a, b) | ExprKind::Logical(_, a, b) => {
                walk_expr(a, out);
                walk_expr(b, out);
            }
            ExprKind::Cond(a, b, c) => {
                walk_expr(a, out);
                walk_expr(b, out);
                walk_expr(c, out);
            }
            ExprKind::Unary(_, x)
            | ExprKind::Update { target: x, .. }
            | ExprKind::Await(x)
            | ExprKind::Yield { arg: Some(x), .. }
            | ExprKind::Chain(x)
            | ExprKind::As(x, _)
            | ExprKind::NonNull(x) => walk_expr(x, out),
            ExprKind::Array(els) => {
                for a in els {
                    match a {
                        ArrEl::Item(x) | ArrEl::Spread(x) => walk_expr(x, out),
                    }
                }
            }
            ExprKind::Object(props) => {
                for p in props {
                    match p {
                        Prop::KV(PropKey::Static(_), value) | Prop::Spread(value) => walk_expr(value, out),
                        Prop::KV(PropKey::Computed(key), value) => {
                            walk_expr(key, out);
                            walk_expr(value, out);
                        }
                        Prop::NullPrototype => {}
                    }
                }
            }
            ExprKind::Template(_, exprs) | ExprKind::Sequence(exprs) => {
                for x in exprs {
                    walk_expr(x, out);
                }
            }
            ExprKind::Func(f) => walk_body(&f.body, out),
            ExprKind::Jsx(j) => {
                for x in j.exprs() {
                    walk_expr(x, out);
                }
            }
            _ => {}
        }
    }

    fn walk_body(body: &FnBody, out: &mut Vec<&'static str>) {
        match body {
            FnBody::Expr(e) => walk_expr(e, out),
            FnBody::Block(stmts) => walk_stmts(stmts, out),
        }
    }

    fn walk_stmts(stmts: &[Stmt], out: &mut Vec<&'static str>) {
        for s in stmts {
            match s {
                Stmt::Exported(inner) => walk_stmts(std::slice::from_ref(inner), out),
                Stmt::ExportDefault(e) | Stmt::Expr(e) | Stmt::Throw(e) => walk_expr(e, out),
                Stmt::Return(Some(e), _) => walk_expr(e, out),
                Stmt::Decl { pat, init, .. } => {
                    if let Some(init) = init {
                        if is_db_expr(init)
                            && let Pat::Obj { props, .. } = pat
                        {
                            for (k, _) in props {
                                check_name(k, out);
                            }
                        }
                        walk_expr(init, out);
                    }
                }
                Stmt::Func(f) => walk_body(&f.body, out),
                Stmt::If(t, a, b) => {
                    walk_expr(t, out);
                    walk_stmts(a, out);
                    if let Some(b) = b {
                        walk_stmts(b, out);
                    }
                }
                Stmt::Block(b) => walk_stmts(b, out),
                Stmt::While(t, b) | Stmt::DoWhile(b, t) => {
                    walk_expr(t, out);
                    walk_stmts(b, out);
                }
                Stmt::For {
                    init,
                    test,
                    update,
                    body,
                    ..
                } => {
                    if let Some(i) = init {
                        walk_stmts(std::slice::from_ref(i), out);
                    }
                    if let Some(t) = test {
                        walk_expr(t, out);
                    }
                    if let Some(u) = update {
                        walk_expr(u, out);
                    }
                    walk_stmts(body, out);
                }
                Stmt::ForOf { iter, body, .. } | Stmt::ForIn { iter, body, .. } => {
                    walk_expr(iter, out);
                    walk_stmts(body, out);
                }
                Stmt::Try {
                    block,
                    handler,
                    finalizer,
                    ..
                } => {
                    walk_stmts(block, out);
                    if let Some(h) = handler {
                        walk_stmts(h, out);
                    }
                    if let Some(f) = finalizer {
                        walk_stmts(f, out);
                    }
                }
                Stmt::Switch { disc, cases, .. } => {
                    walk_expr(disc, out);
                    for (c, b) in cases {
                        if let Some(c) = c {
                            walk_expr(c, out);
                        }
                        walk_stmts(b, out);
                    }
                }
                Stmt::Labeled(_, inner, _) => walk_stmts(std::slice::from_ref(inner), out),
                _ => {}
            }
        }
    }

    let mut used = Vec::new();
    for m in &program.modules {
        walk_stmts(&m.body, &mut used);
    }
    for name in used {
        ext.schema.ensure_builtin(name);
    }
}

/// Validates and applies `defineConfig({ permalinks })` to `ext.schema.collections`.
pub fn apply_permalinks(ext: &mut extract::Extracted, span: Span) -> Result<(), Diag> {
    let permalinks: Vec<(String, String)> = ext
        .schema
        .permalinks
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if permalinks.is_empty() {
        return Ok(());
    }
    let mut url_shapes: Vec<(String, Vec<crate::kind_url::Segment>)> = Vec::new();
    for (kind_key, pattern) in permalinks {
        let pspan = ext.permalink_spans.get(&kind_key).copied().unwrap_or(span);
        ext.schema.ensure_builtin(&kind_key);
        let Some(table) = ext.schema.by_key(&kind_key).map(|c| c.table.clone()) else {
            return Err(Diag::new(
                pspan,
                format!("`permalinks.{kind_key}` names no collection, taxonomy, or built-in kind"),
            )
            .help("use the export name of a collection, taxonomy, or built-in kind (`posts`, `pages`)"));
        };
        let shape = check_kind_url(&ext.schema, &table, &pattern, pspan)?;
        let root = |s: &[crate::kind_url::Segment]| matches!(s, [crate::kind_url::Segment::Path]);
        if let Some((other, _)) = url_shapes
            .iter()
            .find(|(_, s)| crate::kind_url::overlaps(s, &shape) && root(s) == root(&shape))
        {
            return Err(Diag::new(
                pspan,
                format!("\"{pattern}\" can match the same URLs as `{other}`'s permalink"),
            )
            .help("give one of them a different literal prefix, e.g. \"/blog/[slug]\" and \"/docs/[slug]\""));
        }
        url_shapes.push((kind_key, shape));
        ext.schema.collections.get_mut(&table).unwrap().url = Some(pattern);
    }
    Ok(())
}

fn check_kind_url(
    schema: &Schema,
    table: &str,
    pattern: &str,
    span: Span,
) -> Result<Vec<crate::kind_url::Segment>, Diag> {
    let coll = &schema.collections[table];
    if !coll.editor && coll.taxonomy.is_none() && coll.commerce.is_none() {
        return Err(Diag::new(
            span,
            format!(
                "`{}` has no public pages: only collections and taxonomies have canonical URLs",
                coll.key
            ),
        ));
    }
    if coll.taxonomy.is_some()
        && let Some(bad) = pattern
            .split('/')
            .filter_map(|s| s.strip_prefix(':'))
            .find(|p| !matches!(*p, "slug" | "id" | "path"))
    {
        return Err(Diag::new(
            span,
            format!("`:{bad}` in \"{pattern}\" isn't a term placeholder"),
        )
        .help("a term URL takes `:slug`, `:id` and, on a hierarchical taxonomy, `:path`"));
    }
    let public_slug = |target: &str| {
        schema.collections.get(target).is_some_and(|c| {
            (c.editor || c.taxonomy.is_some())
                && match c.access.get("read") {
                    None => true,
                    Some(Access::Role(r)) => r == "anyone",
                    _ => false,
                }
        })
    };
    let kind = crate::kind_url::UrlKind {
        columns: &coll.columns,
        dated: coll.drafts,
        hierarchical: coll.hierarchical,
        public_slug: &public_slug,
    };
    crate::kind_url::check(pattern, &kind).map_err(|e| Diag::new(span, e.message).help(e.help))
}

/// Scans a page module's AST for `db.<kind>.get(...)` calls using route `params`, returning
/// `(kind_key, param_field_map)` pairs (e.g., `("posts", {"slug": "slug"})`).
fn infer_route_kinds(
    module: &crate::ir::Module,
    param_names: &[String],
) -> Vec<(String, indexmap::IndexMap<String, String>)> {
    use crate::ir::{ArrEl, Expr, ExprKind, FnBody, Prop, PropKey, Stmt};

    fn db_kind_get(callee: &Expr) -> Option<String> {
        let ExprKind::Member { obj, prop, .. } = &callee.kind else {
            return None;
        };
        if prop != "get" {
            return None;
        }
        let ExprKind::Member {
            obj: root, prop: kind, ..
        } = &obj.kind
        else {
            return None;
        };
        let is_db = match &root.kind {
            ExprKind::Ident(n) => n == "db",
            ExprKind::Member {
                obj: inner, prop: p, ..
            } => {
                p == "db"
                    || (p == "system"
                        && (matches!(&inner.kind, ExprKind::Ident(n) if n == "db")
                            || matches!(&inner.kind, ExprKind::Member { prop: p2, .. } if p2 == "db")))
            }
            _ => false,
        };
        is_db.then(|| kind.clone())
    }

    fn extract_param_ref(e: &Expr, param_names: &[String]) -> Option<String> {
        match &e.kind {
            ExprKind::Member { obj, prop, .. }
                if matches!(&obj.kind, ExprKind::Ident(n) if n == "params")
                    && param_names.iter().any(|p| p == prop) =>
            {
                Some(prop.clone())
            }
            ExprKind::Ident(n) if param_names.iter().any(|p| p == n) => Some(n.clone()),
            ExprKind::Call { callee, args, .. } => {
                if let ExprKind::Member { obj, .. } = &callee.kind
                    && let Some(p) = extract_param_ref(obj, param_names)
                {
                    return Some(p);
                }
                args.iter().find_map(|a| match a {
                    ArrEl::Item(x) => extract_param_ref(x, param_names),
                    _ => None,
                })
            }
            _ => None,
        }
    }

    fn walk_expr(
        e: &Expr,
        param_names: &[String],
        out: &mut Vec<(String, indexmap::IndexMap<String, String>)>,
    ) {
        match &e.kind {
            ExprKind::Call { callee, args, .. } => {
                if let Some(kind) = db_kind_get(callee)
                    && let Some(ArrEl::Item(arg)) = args.first()
                {
                    let mut mapping = indexmap::IndexMap::new();
                    match &arg.kind {
                        ExprKind::Object(props) => {
                            for p in props {
                                if let Prop::KV(PropKey::Static(key), value) = p
                                    && let Some(param) = extract_param_ref(value, param_names)
                                {
                                    mapping.insert(param, key.clone());
                                }
                            }
                        }
                        _ => {
                            if let Some(param) = extract_param_ref(arg, param_names) {
                                mapping.insert(param, "id".into());
                            }
                        }
                    }
                    if !mapping.is_empty() && !out.iter().any(|(k, _)| k == &kind) {
                        out.push((kind, mapping));
                    }
                }
                walk_expr(callee, param_names, out);
                for a in args {
                    match a {
                        ArrEl::Item(x) | ArrEl::Spread(x) => walk_expr(x, param_names, out),
                    }
                }
            }
            ExprKind::Member { obj, .. } => walk_expr(obj, param_names, out),
            ExprKind::Index { obj, index, .. } => {
                walk_expr(obj, param_names, out);
                walk_expr(index, param_names, out);
            }
            ExprKind::Assign { target, value, .. } => {
                walk_expr(target, param_names, out);
                walk_expr(value, param_names, out);
            }
            ExprKind::Binary(_, a, b) | ExprKind::Logical(_, a, b) => {
                walk_expr(a, param_names, out);
                walk_expr(b, param_names, out);
            }
            ExprKind::Cond(a, b, c) => {
                walk_expr(a, param_names, out);
                walk_expr(b, param_names, out);
                walk_expr(c, param_names, out);
            }
            ExprKind::Unary(_, x)
            | ExprKind::Update { target: x, .. }
            | ExprKind::Await(x)
            | ExprKind::Yield { arg: Some(x), .. }
            | ExprKind::Chain(x)
            | ExprKind::As(x, _)
            | ExprKind::NonNull(x) => walk_expr(x, param_names, out),
            ExprKind::Array(els) => {
                for a in els {
                    match a {
                        ArrEl::Item(x) | ArrEl::Spread(x) => walk_expr(x, param_names, out),
                    }
                }
            }
            ExprKind::Object(props) => {
                for p in props {
                    match p {
                        Prop::KV(PropKey::Static(_), value) | Prop::Spread(value) => {
                            walk_expr(value, param_names, out)
                        }
                        Prop::KV(PropKey::Computed(key), value) => {
                            walk_expr(key, param_names, out);
                            walk_expr(value, param_names, out);
                        }
                        Prop::NullPrototype => {}
                    }
                }
            }
            ExprKind::Template(_, exprs) | ExprKind::Sequence(exprs) => {
                for x in exprs {
                    walk_expr(x, param_names, out);
                }
            }
            ExprKind::Func(f) => walk_body(&f.body, param_names, out),
            ExprKind::Jsx(j) => {
                for x in j.exprs() {
                    walk_expr(x, param_names, out);
                }
            }
            _ => {}
        }
    }

    fn walk_body(
        body: &FnBody,
        param_names: &[String],
        out: &mut Vec<(String, indexmap::IndexMap<String, String>)>,
    ) {
        match body {
            FnBody::Expr(e) => walk_expr(e, param_names, out),
            FnBody::Block(stmts) => walk_stmts(stmts, param_names, out),
        }
    }

    fn walk_stmts(
        stmts: &[Stmt],
        param_names: &[String],
        out: &mut Vec<(String, indexmap::IndexMap<String, String>)>,
    ) {
        for s in stmts {
            match s {
                Stmt::Exported(inner) => walk_stmts(std::slice::from_ref(inner), param_names, out),
                Stmt::ExportDefault(e) | Stmt::Expr(e) | Stmt::Throw(e) => walk_expr(e, param_names, out),
                Stmt::Return(Some(e), _) => walk_expr(e, param_names, out),
                Stmt::Decl { init: Some(e), .. } => walk_expr(e, param_names, out),
                Stmt::Func(f) => walk_body(&f.body, param_names, out),
                Stmt::If(t, a, b) => {
                    walk_expr(t, param_names, out);
                    walk_stmts(a, param_names, out);
                    if let Some(b) = b {
                        walk_stmts(b, param_names, out);
                    }
                }
                Stmt::Block(b) => walk_stmts(b, param_names, out),
                Stmt::While(t, b) | Stmt::DoWhile(b, t) => {
                    walk_expr(t, param_names, out);
                    walk_stmts(b, param_names, out);
                }
                Stmt::For {
                    init,
                    test,
                    update,
                    body,
                    ..
                } => {
                    if let Some(i) = init {
                        walk_stmts(std::slice::from_ref(i), param_names, out);
                    }
                    if let Some(t) = test {
                        walk_expr(t, param_names, out);
                    }
                    if let Some(u) = update {
                        walk_expr(u, param_names, out);
                    }
                    walk_stmts(body, param_names, out);
                }
                Stmt::ForOf { iter, body, .. } | Stmt::ForIn { iter, body, .. } => {
                    walk_expr(iter, param_names, out);
                    walk_stmts(body, param_names, out);
                }
                Stmt::Try {
                    block,
                    handler,
                    finalizer,
                    ..
                } => {
                    walk_stmts(block, param_names, out);
                    if let Some(h) = handler {
                        walk_stmts(h, param_names, out);
                    }
                    if let Some(f) = finalizer {
                        walk_stmts(f, param_names, out);
                    }
                }
                Stmt::Switch { disc, cases, .. } => {
                    walk_expr(disc, param_names, out);
                    for (c, b) in cases {
                        if let Some(c) = c {
                            walk_expr(c, param_names, out);
                        }
                        walk_stmts(b, param_names, out);
                    }
                }
                Stmt::Labeled(_, inner, _) => walk_stmts(std::slice::from_ref(inner), param_names, out),
                _ => {}
            }
        }
    }

    let mut out = Vec::new();
    walk_stmts(&module.body, param_names, &mut out);
    out
}

/// Converts a dynamic `app::Route` into a `kind_url` pattern (e.g. `/blog/:slug` or `/docs/:path`).
fn route_to_url_pattern(
    route: &app::Route,
    param_fields: &indexmap::IndexMap<String, String>,
    coll: &crate::schema::Collection,
) -> String {
    let mut out = String::new();
    for seg in &route.segments {
        out.push('/');
        match seg {
            app::Segment::Literal(l) => out.push_str(l),
            app::Segment::Param(p) => {
                out.push(':');
                if let Some(field) = param_fields.get(p) {
                    out.push_str(field);
                } else if p == "id" || p == "slug" || p == "year" || p == "month" || p == "day" {
                    out.push_str(p);
                } else if coll.columns.contains_key(p) {
                    out.push_str(p);
                } else if coll.slug.is_some() {
                    out.push_str("slug");
                } else {
                    out.push_str("id");
                }
            }
            app::Segment::CatchAll(_) | app::Segment::OptionalCatchAll(_) => {
                out.push_str(":path");
            }
        }
    }
    out
}

/// Binds each kind's canonical URL from `sp/app/` dynamic pages (or explicit `export const canonical`).
fn bind_canonical_routes(
    program: &loader::Program,
    files: &indexmap::IndexMap<String, AppFile>,
    ext: &mut extract::Extracted,
) -> Result<(), Diag> {
    struct Candidate {
        file: String,
        pattern: String,
        explicit: bool,
        span: Span,
    }
    let module_of = |file: &str| program.app_files.iter().find(|(p, _)| p == file).map(|(_, m)| *m);
    let mut per_kind: indexmap::IndexMap<String, Vec<Candidate>> = indexmap::IndexMap::new();

    for route in &program.app.routes {
        if route.kind != RouteKind::Page {
            continue;
        }
        let Some(file) = files.get(&route.file) else { continue };
        let Some(module_idx) = module_of(&route.file) else { continue };
        let span = at(program, module_idx);
        let param_names: Vec<String> = route
            .segments
            .iter()
            .filter_map(|s| match s {
                app::Segment::Param(n) | app::Segment::CatchAll(n) | app::Segment::OptionalCatchAll(n) => {
                    Some(n.clone())
                }
                app::Segment::Literal(_) => None,
            })
            .collect();
        if param_names.is_empty() {
            if let Some(Some(kind_key)) = &file.canonical {
                return Err(Diag::new(
                    export_at(program, module_idx, "canonical"),
                    format!("`canonical = \"{kind_key}\"` needs a dynamic route segment like `[slug]` or `[...path]`"),
                ));
            }
            continue;
        }
        match &file.canonical {
            Some(None) => continue, // `export const canonical = false`
            Some(Some(kind_key)) => {
                let cspan = export_at(program, module_idx, "canonical");
                ext.schema.ensure_builtin(kind_key);
                let Some(table) = ext.schema.by_key(kind_key).map(|c| c.table.clone()) else {
                    return Err(Diag::new(
                        cspan,
                        format!("`canonical = \"{kind_key}\"` names no collection, taxonomy, or built-in kind"),
                    ));
                };
                let inferred = infer_route_kinds(&program.modules[module_idx], &param_names);
                let fields = inferred
                    .into_iter()
                    .find(|(k, _)| k == kind_key)
                    .map(|(_, m)| m)
                    .unwrap_or_default();
                let pattern = route_to_url_pattern(route, &fields, &ext.schema.collections[&table]);
                check_kind_url(&ext.schema, &table, &pattern, cspan)?;
                per_kind.entry(table).or_default().push(Candidate {
                    file: route.file.clone(),
                    pattern,
                    explicit: true,
                    span: cspan,
                });
            }
            None => {
                let inferred = infer_route_kinds(&program.modules[module_idx], &param_names);
                // Only auto-bind when the page unambiguously loads a single kind by route param.
                let matched: Vec<(String, indexmap::IndexMap<String, String>)> = inferred
                    .into_iter()
                    .filter(|(k, _)| {
                        ext.schema.ensure_builtin(k);
                        ext.schema
                            .by_key(k)
                            .is_some_and(|c| c.editor || c.taxonomy.is_some() || c.commerce.is_some())
                    })
                    .collect();
                if matched.len() == 1 {
                    let (kind_key, fields) = &matched[0];
                    let table = ext.schema.by_key(kind_key).unwrap().table.clone();
                    let pattern = route_to_url_pattern(route, fields, &ext.schema.collections[&table]);
                    // Auto-inference silently skips patterns that aren't valid canonical URLs (e.g. non-identifying params).
                    if check_kind_url(&ext.schema, &table, &pattern, span).is_ok() {
                        per_kind.entry(table).or_default().push(Candidate {
                            file: route.file.clone(),
                            pattern,
                            explicit: false,
                            span,
                        });
                    }
                }
            }
        }
    }

    for (table, candidates) in per_kind {
        if ext.schema.collections[&table].url.is_some() {
            continue; // Already set via `permalinks`.
        }
        let explicit: Vec<&Candidate> = candidates.iter().filter(|c| c.explicit).collect();
        let chosen = if explicit.len() == 1 {
            explicit[0]
        } else if explicit.len() > 1 {
            let key = &ext.schema.collections[&table].key;
            let list = explicit.iter().map(|c| c.file.as_str()).collect::<Vec<_>>().join(", ");
            return Err(Diag::new(
                explicit[1].span,
                format!("multiple pages set `canonical = \"{key}\"` ({list})"),
            )
            .help("keep `export const canonical` on the single canonical page for this kind"));
        } else if candidates.len() == 1 {
            &candidates[0]
        } else {
            let key = &ext.schema.collections[&table].key;
            let list = candidates.iter().map(|c| c.file.as_str()).collect::<Vec<_>>().join(", ");
            return Err(Diag::new(
                candidates[1].span,
                format!("multiple pages load `{key}` ({list}), so its canonical URL is ambiguous"),
            )
            .help(format!(
                "add `export const canonical = \"{key}\"` on the canonical page, or `export const canonical = false` on the others"
            )));
        };
        ext.schema.collections.get_mut(&table).unwrap().url = Some(chosen.pattern.clone());
    }
    Ok(())
}

pub fn register(
    program: &loader::Program,
    ev: &mut eval::Evaluator,
    ext: &mut extract::Extracted,
    block_modules: &[usize],
) -> Result<(), Diag> {
    if program.app.routes.is_empty() && program.app.not_found.is_none() && program.app.login.is_none() {
        return Ok(());
    }
    let mut files = indexmap::IndexMap::new();
    // Explicit route ids (`export const route = { id }`), by route file.
    let mut ids: indexmap::IndexMap<String, (String, Span)> = indexmap::IndexMap::new();
    for (path, module) in &program.app_files {
        let span = at(program, *module);
        let exports = ev.run_module(*module)?;
        let allowed = app::allowed_exports(path);
        for name in exports.keys() {
            if !allowed.contains(&name.as_str()) {
                let help = if name == "guard" {
                    "rename `export const guard` to `export const access`".to_string()
                } else if name.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
                    "move components into sp/components/ (or a `_private` folder) and import them".to_string()
                } else {
                    format!(
                        "{path} exports only {}; move helpers into a module it imports",
                        allowed.join(", ")
                    )
                };
                let msg = if name == "guard" {
                    format!("{path}: `export const guard` is now `export const access`")
                } else {
                    format!("{path} can't export `{name}`")
                };
                return Err(Diag::new(span, msg).help(help));
            }
        }
        let stem = stem(path);
        let mut file = AppFile::default();
        let handler = path.ends_with("route.ts");
        if let Some(v) = exports.get("route") {
            let span = export_at(program, *module, "route");
            let id = route_id(v, span)?;
            if let Some((other, _)) = ids.iter().find(|(_, (i, _))| *i == id) {
                return Err(Diag::new(span, format!("route id `{id}` is already {other}'s"))
                    .help("give each page its own id; an id keeps the page's WordPress Page when the file moves"));
            }
            ids.insert(path.clone(), (id, span));
        }
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
        if let Some(search) = exports.get("search") {
            file.search = Some(search_fields(search, span, ev, ext)?);
        }
        match exports.get("prerender") {
            None | Some(Value::Undef) => {}
            Some(Value::Bool(b)) => file.prerender = Some(*b),
            Some(other) => {
                return Err(Diag::new(span, format!("`prerender` is {}, not true or false", other.describe()))
                    .help("write `export const prerender = true` to prebuild the page, or `false` to render it per request"));
            }
        }
        file.template = template(path, exports.get("template"), program, *module, span)?;
        // A root layout that draws chrome of its own doesn't render under the theme's header and
        // footer (docs/pages.md "Block templates"): say so, once, at build time.
        if file.template.is_none()
            && is_root_layout(path, &program.app)
            && let Some(Value::Closure(c)) = exports.get("default")
            && draws_chrome(&c.func)
        {
            let hint = format!(
                "{path} renders markup around {{children}}, which the theme's header and footer replace on a block theme; add `export const template = \"blank\"` to keep it (docs/pages.md \"Block templates\")"
            );
            if !ext.hints.contains(&hint) {
                ext.hints.push(hint);
            }
        }
        match exports.get("staticParams") {
            None | Some(Value::Undef) => {}
            Some(Value::Closure(c)) => {
                file.static_params = Some(String::new());
                ext.roots.push(Root {
                    closure: c.clone(),
                    slot: Slot::AppStaticParams { file: path.clone() },
                    name: format!("{stem}__static_params"),
                    plugin: None,
                });
            }
            Some(other) => {
                return Err(
                    Diag::new(span, format!("`staticParams` is {}, not a function", other.describe()))
                        .help("write `export async function staticParams() { return [{ slug: \"hello\" }]; }`"),
                );
            }
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
        match exports.get("canonical") {
            None | Some(Value::Undef) => {}
            Some(Value::Bool(false)) => file.canonical = Some(None),
            Some(Value::Str(s)) => file.canonical = Some(Some(s.to_string())),
            Some(other) => {
                return Err(Diag::new(
                    export_at(program, *module, "canonical"),
                    format!("`canonical` is {}, not a collection name or false", other.describe()),
                )
                .help("write `export const canonical = \"posts\"` to claim a kind's canonical URL, or `export const canonical = false` to opt out"));
            }
        }
        // A signed webhook proves its sender with an HMAC over the raw body and runs as the system.
        if let Some(signature) = exports.get("signature") {
            let span = export_at(program, *module, "signature");
            if file.methods.is_empty() {
                return Err(
                    Diag::new(span, format!("{path} exports `signature` but no HTTP handler")).help(
                        "a signature authenticates HTTP handlers such as `POST`; use `access` for the page itself",
                    ),
                );
            }
            file.signature = Some(extract::signature_config(signature, span)?);
        }
        if let Some(value) = exports.get("access") {
            register_guard(
                path,
                export_at(program, *module, "access"),
                value,
                handler,
                &mut file,
                &mut ext.roots,
            )?;
        } else if !file.methods.is_empty() && file.signature.is_none() {
            return Err(Diag::new(span, format!("{path} has HTTP handlers but no `access`"))
                .help("say who may call them: `export const access = \"anyone\"` (or a role), or `export const signature = { secret: env(\"…\"), header, scheme }` for a signed webhook"));
        }
        files.insert(path.clone(), file);
    }
    bind_canonical_routes(program, &files, ext)?;
    let kinds: Vec<(String, String)> = ext
        .schema
        .collections
        .iter()
        .filter_map(|(name, c)| c.url.clone().map(|u| (name.clone(), u)))
        .collect();
    // A page's stylesheets: what its layouts (root first) and the page itself import, then the
    // block components content may render on it.
    let module_of = |file: &str| program.app_files.iter().find(|(p, _)| p == file).map(|(_, m)| *m);
    prebuilt(program, &files, &kinds, ext.schema.output)?;
    let output = ext.schema.output;
    let route = |r: &app::Route| {
        let roots: Vec<usize> = r
            .layouts
            .iter()
            .chain((r.kind == RouteKind::Page).then_some(&r.file))
            .filter_map(|f| module_of(f))
            .chain(block_modules.iter().copied())
            .collect();
        AppRoute {
            plan: None,
            prerender: r.kind == RouteKind::Page
                && files.get(&r.file).map_or(output == Output::Static, |f| {
                    f.prerender.unwrap_or(output == Output::Static)
                }),
            styles: crate::assets::stylesheets(program, &roots),
            preloads: crate::assets::preloads(program, &roots),
            id: ids.get(&r.file).map(|(id, _)| id.clone()).unwrap_or_else(|| r.id()),
            explicit_id: ids.get(&r.file).map(|(_, span)| *span),
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
        }
    };
    for asset in program.assets.values() {
        if asset.emits_file() && !asset.file.starts_with('/') {
            ext.schema.assets.insert(asset.file.clone(), asset.bytes.clone());
            if let Some(meta) = &asset.meta {
                ext.schema.assets_meta.insert(asset.file.clone(), meta.clone());
            }
        }
    }
    ext.schema.app = Some(crate::schema::App {
        routes: program.app.routes.iter().map(route).collect(),
        not_found: program.app.not_found.as_ref().map(route),
        login: program.app.login.as_ref().map(route),
        files,
        content: indexmap::IndexMap::new(),
    });
    Ok(())
}

/// WordPress functions whose answer depends on who is asking: a prebuilt page is one file for every
/// visitor, so a page that calls one (or imports a module that does) can't be prebuilt.
const VIEWER_FUNCTIONS: &[&str] = &["is_user_logged_in", "current_user_can", "get_current_user_id"];

/// Refuses a prebuilt page whose modules ask WordPress who the visitor is, at the call. Reads through
/// `db` are bound to the visitor and need no check: the build renders as a signed-out visitor.
pub fn viewer_calls(
    program: &loader::Program,
    app: &crate::schema::App,
    uses: &[crate::compile::WordPressUse],
) -> Result<(), Diag> {
    let module_of = |file: &str| program.app_files.iter().find(|(p, _)| p == file).map(|(_, m)| *m);
    for route in app.routes.iter().filter(|r| r.prerender) {
        let mut seen = std::collections::BTreeSet::new();
        let mut stack: Vec<usize> = route
            .layouts
            .iter()
            .chain(route.page.as_ref())
            .filter_map(|f| module_of(f))
            .collect();
        while let Some(m) = stack.pop() {
            if seen.insert(m) {
                stack.extend(
                    program
                        .resolved
                        .iter()
                        .filter(|((from, _), _)| *from == m)
                        .map(|(_, to)| *to),
                );
            }
        }
        let files: std::collections::BTreeSet<u32> = seen.iter().map(|m| program.modules[*m].file).collect();
        if let Some(call) = uses.iter().find(|u| {
            u.kind == crate::compile::WordPressKind::Function
                && VIEWER_FUNCTIONS.contains(&u.name.as_str())
                && files.contains(&u.span.file)
        }) {
            let page = route.page.as_deref().unwrap_or(&route.id);
            return Err(Diag::new(call.span, format!("{page} is prebuilt, and `{}` asks who the visitor is", call.name))
                .help("a prebuilt page is the same file for every visitor: move this into a client component or a page that renders per request (`export const prerender = false`, with `output: \"server\"`)"));
        }
    }
    Ok(())
}

/// Which pages are prebuilt, checked against what a prebuilt page can be
/// (docs/decisions/2026-11-13-static-output.md): an anonymous visitor's render with nothing from the
/// request, at a URL the build can list. Each refusal names the page and the fix.
fn prebuilt(
    program: &loader::Program,
    files: &indexmap::IndexMap<String, AppFile>,
    kinds: &[(String, String)],
    output: Output,
) -> Result<(), Diag> {
    let span = |file: &str| {
        program
            .app_files
            .iter()
            .find(|(p, _)| p == file)
            .map_or(Span::NONE, |(_, m)| at(program, *m))
    };
    for route in &program.app.routes {
        if route.kind != RouteKind::Page {
            continue;
        }
        let path = &route.file;
        // `page.md`: a WordPress Page the site owns, prebuilt with the rest in a static site.
        let Some(file) = files.get(path) else { continue };
        let at = span(path);
        if output == Output::Static && file.prerender == Some(false) {
            return Err(Diag::new(at, format!("{path} says `prerender = false`, and `output: \"static\"` prebuilds every page"))
                .help("remove `export const prerender = false`, or set `output: \"server\"` in spacepress.config.ts to render pages per request"));
        }
        let dynamic = route.segments.iter().any(|s| !matches!(s, app::Segment::Literal(_)));
        let serves_kind = kinds.iter().any(|(_, url)| app::serves_kind_url(route, url).is_some());
        let prerender = file.prerender.unwrap_or(output == Output::Static);
        if file.static_params.is_some() {
            if !dynamic {
                return Err(Diag::new(
                    at,
                    format!("{path} exports `staticParams`, and its URL has no parameter"),
                )
                .help("staticParams lists the values of a `[name]` folder; remove it from a page at one URL"));
            }
            if serves_kind {
                return Err(Diag::new(at, format!("{path} exports `staticParams`, and it serves a kind's `url`"))
                    .help("a page that serves a kind's url is prebuilt for every published item of that kind; remove staticParams"));
            }
            if !prerender {
                return Err(
                    Diag::new(at, format!("{path} exports `staticParams`, but it isn't prebuilt")).help(
                        "add `export const prerender = true`, or remove staticParams to render the page per request",
                    ),
                );
            }
        }
        if !prerender {
            continue;
        }
        let why = if output == Output::Static && file.prerender.is_none() {
            "`output: \"static\"` prebuilds every page"
        } else {
            "it says `prerender = true`"
        };
        let fix = if output == Output::Static {
            "set `output: \"server\"` in spacepress.config.ts and `export const prerender = false` here to render it per request"
        } else {
            "remove `export const prerender = true` to render it per request"
        };
        if dynamic && !serves_kind && file.static_params.is_none() {
            return Err(Diag::new(at, format!("{path} is prebuilt ({why}), and nothing lists its URLs"))
                .help(format!("export `async function staticParams() {{ return [{{ {}: \"…\" }}]; }}` with one entry per page to build, or {fix}", app::params_of(path).first().map(|(n, _)| n.as_str()).unwrap_or("slug"))));
        }
        if file.search.is_some() {
            return Err(
                Diag::new(at, format!("{path} is prebuilt ({why}), and it reads `search`")).help(format!(
                    "a prebuilt page is one file with no query string: remove `export const search`, or {fix}"
                )),
            );
        }
        if !file.methods.is_empty() && output == Output::Static {
            return Err(Diag::new(
                at,
                format!("{path} has HTTP handlers, and a static site has no server to answer them"),
            )
            .help("move the handler into an action the page's client component calls, or set `output: \"server\"`"));
        }
        if file.guard.is_some() {
            return Err(
                Diag::new(at, format!("{path} is prebuilt ({why}), and it has a read access rule"))
                    .help(format!("a prebuilt page is the same file for every visitor; {fix}")),
            );
        }
        if let Some(layout) = route
            .layouts
            .iter()
            .find(|l| files.get(*l).is_some_and(|f| f.guard.is_some()))
        {
            return Err(Diag::new(at, format!("{path} is prebuilt ({why}), and {layout} guards it"))
                .help(format!("a prebuilt page is the same file for every visitor: move the page out of the guarded section, or {fix}")));
        }
    }
    Ok(())
}

/// A literal `metadata` object, checked: strings for `title`, `description`, `canonical`, and a
/// layout's `title: { default, template }`; `robots: { index, follow }` booleans;
/// `openGraph: { title, description, image, type }` and `twitter: { card }` strings; `links`, a
/// list of `{ rel, href, type? }` for the head; and `scripts`, script modules the page loads.
const HELP: &str = "metadata takes title, description, canonical, robots: { index, follow }, openGraph, twitter: { card }, links and scripts";
const OPEN_GRAPH: &[&str] = &["title", "description", "image", "type"];
const OPEN_GRAPH_SHAPE: &str = "{ title?, description?, image?, type? }, each a string";
const LINK_SHAPE: &str = "a list of { rel: string, href: string, type?: string }";
const SCRIPTS_SHAPE: &str =
    "a list of script module URLs: paths on this site (`/playground.js`, a file in public/) or https:// URLs";

/** A script a page loads: a path on this site, or an https:// URL. */
fn script_src(src: &str) -> bool {
    (src.starts_with('/') && !src.starts_with("//")) || src.starts_with("https://")
}

fn metadata_literal(v: &Value, span: Span) -> Result<serde_json::Value, Diag> {
    let Value::Object(o) = v else { unreachable!() };
    let mut out = serde_json::Map::new();
    for (k, v) in o.borrow().iter() {
        let bad = |what: &str| Diag::new(span, format!("`metadata.{k}` must be {what}")).help(HELP);
        let strings = |o: &crate::value::Obj, keys: &[&str], required: &[&str], what: &str| {
            let mut out = serde_json::Map::new();
            for (ok, ov) in o.borrow().iter() {
                match ov {
                    Value::Undef => {}
                    Value::Str(s) if keys.contains(&ok.as_str()) => {
                        out.insert(ok.clone(), serde_json::Value::String(s.to_string()));
                    }
                    _ => return Err(bad(what)),
                }
            }
            if required.iter().any(|r| !out.contains_key(*r)) {
                return Err(bad(what));
            }
            Ok(serde_json::Value::Object(out))
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
            ("openGraph", Value::Object(g)) => strings(g, OPEN_GRAPH, &[], OPEN_GRAPH_SHAPE)?,
            ("twitter", Value::Object(t)) => strings(t, &["card"], &["card"], "{ card: string }")?,
            ("links", Value::Array(items)) => serde_json::Value::Array(
                items
                    .borrow()
                    .iter()
                    .map(|item| match item {
                        Value::Object(l) => strings(l, &["rel", "href", "type"], &["rel", "href"], LINK_SHAPE),
                        _ => Err(bad(LINK_SHAPE)),
                    })
                    .collect::<Result<_, _>>()?,
            ),
            ("scripts", Value::Array(items)) => serde_json::Value::Array(
                items
                    .borrow()
                    .iter()
                    .map(|item| match item {
                        Value::Str(src) if script_src(src) => Ok(serde_json::Value::String(src.to_string())),
                        _ => Err(bad(SCRIPTS_SHAPE)),
                    })
                    .collect::<Result<_, _>>()?,
            ),
            ("scripts", _) => return Err(bad(SCRIPTS_SHAPE)),
            ("openGraph", _) => return Err(bad(OPEN_GRAPH_SHAPE)),
            ("twitter", _) => return Err(bad("{ card: string }")),
            ("links", _) => return Err(bad(LINK_SHAPE)),
            ("title" | "description" | "canonical", _) => return Err(bad("a string")),
            ("robots", _) => return Err(bad("{ index?: boolean, follow?: boolean }")),
            _ => {
                return Err(Diag::new(span, format!("`metadata` has no field `{k}`")).help(HELP));
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
            app.files.get_mut(file).expect("app file").handler_guard = Some(Access::Fn(name.to_string()));
            true
        }
        Slot::AppGuard { file } => {
            let file = app.files.get_mut(file).expect("app file");
            let guard = Access::Fn(name.to_string());
            if !file.methods.is_empty() && file.handler_guard.is_none() && file.signature.is_none() {
                file.handler_guard = Some(guard.clone());
            }
            file.guard = Some(guard);
            true
        }
        Slot::AppStaticParams { file } => {
            app.files.get_mut(file).expect("app file").static_params = Some(name.to_string());
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
