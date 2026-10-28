//! Reads the schema out of the evaluated config value, enforces every config
//! rule that doesn't need the PHP compiler (§1 of the design), and lists the
//! functions (hooks, actions, access rules, validators, `$default`/`$onUpdate`
//! callbacks) the compiler must emit.

use crate::diag::{Diag, Result, Span, suggest};
use crate::eval::{Evaluator, kind_phrase, to_json};
use crate::ir::{ExprKind, FnBody, Pat, Stmt};
use crate::schema::*;
use crate::value::*;
use indexmap::IndexMap;
use serde_json::Value as Json;
use std::rc::Rc;

/// Where a compiled function's PHP name goes once it's known.
#[derive(Debug, Clone)]
pub enum Slot {
    Hook { table: String, kind: HookKind },
    Default { at: ColPath },
    OnUpdate { at: ColPath },
    Validate { at: ColPath },
    ActionHandler { action: String },
    Access { owner: Owner, op: String },
}

#[derive(Debug, Clone)]
pub struct Root {
    pub closure: Rc<Closure>,
    pub slot: Slot,
    /// Suggested PHP function name.
    pub name: String,
}

pub struct Extracted {
    pub schema: Schema,
    pub roots: Vec<Root>,
    /// Schema-key → collection value, for resolving captured collections.
    pub collections: Vec<Rc<CollectionVal>>,
    /// Module that holds `export const relations` / `schema`, for zero.gen.ts.
    pub register_name: Option<&'static str>,
    /// Non-fatal advice printed by `zero build` (§3.5.1 postmeta hint).
    pub hints: Vec<String>,
}

const CONFIG_KEYS: &[&str] = &["name", "target", "schema", "relations", "globals", "hooks", "actions"];
const COLLECTION_OPTIONS: &[&str] = &[
    "label",
    "editor",
    "drafts",
    "revisions",
    "title",
    "content",
    "access",
    "api",
];
/// Collection names that would shadow a built-in route (§4.8).
const RESERVED_COLLECTIONS: &[&str] = &["media", "globals", "actions", "me", "_schema", "auth"];
/// WordPress limits post types to 20 characters; Zero prefixes `zero_`.
const MAX_POST_TYPE_TABLE: usize = 15;
/// MySQL utf8mb4 index prefix limit.
const MAX_UNIQUE_TEXT: f64 = 191.0;
const MAX_NESTING: usize = 3;

/// Where a column is declared; decides which builders and modifiers it may use.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Place {
    /// A collection column.
    Top,
    /// Inside group/repeater/blocks; depth counts the top column as 1.
    Sub(usize),
    Global,
    Input,
}

impl Place {
    fn depth(self) -> usize {
        match self {
            Place::Sub(d) => d,
            _ => 1,
        }
    }

    fn where_(self) -> &'static str {
        match self {
            Place::Top => "on a collection column",
            Place::Sub(_) => "inside a group, repeater, or blocks field",
            Place::Global => "on a global field",
            Place::Input => "on an action input",
        }
    }
}

pub fn extract(
    config: &Value,
    ev: &mut Evaluator<'_>,
    config_span: Span,
    default_name: &str,
    target_override: Option<Target>,
) -> Result<Extracted> {
    let Value::Object(cfg) = config else {
        return Err(Diag::new(
            config_span,
            format!(
                "the default export must be defineConfig({{ ... }}), not {}",
                config.describe()
            ),
        ));
    };
    let cfg_map = cfg.borrow().clone();
    let span_of =
        |ev: &Evaluator<'_>, obj: &Value, key: &str, fallback: Span| ev.key_span(obj, key).unwrap_or(fallback);
    for key in cfg_map.keys() {
        if !CONFIG_KEYS.contains(&key.as_str()) {
            let mut d = Diag::new(
                span_of(ev, config, key, config_span),
                format!("defineConfig() has no option `{key}`"),
            );
            if let Some(s) = suggest(key, CONFIG_KEYS.iter().copied()) {
                d = d.help(format!("did you mean `{s}`?"));
            }
            return Err(d);
        }
    }

    let mut out = Extracted {
        schema: Schema::default(),
        roots: Vec::new(),
        collections: Vec::new(),
        register_name: None,
        hints: Vec::new(),
    };

    out.schema.name = match cfg_map.get("name") {
        None | Some(Value::Undef) => default_name.to_string(),
        Some(Value::Str(s)) if is_slug(s) => s.to_string(),
        Some(other) => {
            return Err(Diag::new(
                span_of(ev, config, "name", config_span),
                format!(
                    "`name` must be a lowercase slug like \"blog\", not {}",
                    other.describe()
                ),
            )
            .help("it becomes the WordPress plugin slug `zero-<name>`"));
        }
    };
    let config_target = match cfg_map.get("target") {
        None | Some(Value::Undef) => Target::Standalone,
        Some(Value::Str(s)) if Target::parse(s).is_some() => Target::parse(s).expect("target"),
        Some(other) => {
            return Err(Diag::new(
                span_of(ev, config, "target", config_span),
                format!("`target` must be \"standalone\" or \"wp\", not {}", other.describe()),
            ));
        }
    };
    out.schema.target = target_override.unwrap_or(config_target);

    // Collections
    let schema_val = match cfg_map.get("schema") {
        Some(v @ Value::Object(_)) => v.clone(),
        Some(other) => {
            return Err(Diag::new(
                span_of(ev, config, "schema", config_span),
                format!("`schema` must be an object of collections, not {}", other.describe()),
            ));
        }
        None => {
            return Err(Diag::new(config_span, "defineConfig() needs a `schema`")
                .help("pass your collections: `defineConfig({ schema: { items } })`"));
        }
    };
    out.register_name = Some("schema");
    let Value::Object(schema_map) = &schema_val else {
        unreachable!()
    };
    let schema_entries = schema_map.borrow().clone();
    for (key, v) in &schema_entries {
        let span = span_of(ev, &schema_val, key, config_span);
        let Value::Collection(c) = v else {
            return Err(Diag::new(
                span,
                format!("schema entry `{key}` is {}, not a collection", v.describe()),
            ));
        };
        if out.schema.collections.contains_key(&c.table) {
            return Err(Diag::new(
                span,
                format!("two collections use the table name \"{}\"", c.table),
            ));
        }
        if !valid_ident(&c.table) {
            return Err(
                Diag::new(c.span, format!("\"{}\" isn't a valid collection name", c.table))
                    .help("use letters, digits, and underscores, starting with a letter"),
            );
        }
        if RESERVED_COLLECTIONS.contains(&c.table.as_str()) {
            return Err(Diag::new(
                c.span,
                format!(
                    "\"{}\" is reserved: Zero serves a built-in route with that name",
                    c.table
                ),
            )
            .help("pick another name, e.g. \"assets\" instead of \"media\""));
        }
        out.collections.push(c.clone());
        out.schema.collections.insert(
            c.table.clone(),
            Collection {
                key: key.clone(),
                table: c.table.clone(),
                label: title_case(&c.table),
                editor: true,
                drafts: true,
                revisions: true,
                title: None,
                content: None,
                slug: None,
                columns: IndexMap::new(),
                relations: IndexMap::new(),
                hooks: IndexMap::new(),
                before_create_fills: Vec::new(),
                access: IndexMap::new(),
                api: Api {
                    list: true,
                    get: true,
                    create: true,
                    update: true,
                    delete: true,
                },
            },
        );
    }
    for c in out.collections.clone() {
        let owner = Owner::Collection(c.table.clone());
        let mut columns = IndexMap::new();
        for (name, b) in &c.columns {
            let col = column(name, b, &owner, &[], Place::Top, ev, &mut out)?;
            columns.insert(name.clone(), col);
        }
        let pks: Vec<&Column> = columns.values().filter(|c| c.primary_key).collect();
        if pks.is_empty() {
            return Err(
                Diag::new(c.span, format!("collection \"{}\" has no primary key", c.table)).help("add `id: id()`"),
            );
        }
        if pks.len() > 1 {
            return Err(Diag::new(
                c.span,
                format!("collection \"{}\" has more than one primary key", c.table),
            ));
        }
        let opts = collection_options(&c, &columns, ev, &mut out)?;
        let coll = out.schema.collections.get_mut(&c.table).expect("collection");
        coll.columns = columns;
        coll.label = opts.label;
        coll.editor = opts.editor;
        coll.drafts = opts.drafts;
        coll.revisions = opts.revisions;
        coll.title = opts.title;
        coll.content = opts.content;
        coll.slug = opts.slug;
        coll.access = opts.access;
        coll.api = opts.api;
        if coll.drafts {
            let mut status = Column::new("status", ColType::Text);
            status.not_null = true;
            status.enum_values = Some(vec!["draft".into(), "published".into(), "scheduled".into()]);
            status.default = Some(DefaultKind::Value(Json::String("published".into())));
            status.system = true;
            let mut published_at = Column::new("publishedAt", ColType::Timestamp);
            published_at.system = true;
            coll.columns.insert("status".into(), status);
            coll.columns.insert("publishedAt".into(), published_at);
        }
    }
    postmeta_hints(&mut out);

    // Relations
    if let Some(rel) = cfg_map.get("relations") {
        relations(rel, ev, &mut out, span_of(ev, config, "relations", config_span))?;
        out.register_name = Some("relations");
    }

    // Globals
    if let Some(globals_val) = cfg_map.get("globals") {
        let gspan = span_of(ev, config, "globals", config_span);
        let Value::Object(globals) = globals_val else {
            return Err(Diag::new(gspan, "`globals` must be an object of global(...) values"));
        };
        for (key, g) in globals.borrow().iter() {
            let kspan = span_of(ev, globals_val, key, gspan);
            let Value::Global(g) = g else {
                return Err(Diag::new(
                    kspan,
                    format!("`globals.{key}` is {}, not global(...)", g.describe()),
                ));
            };
            global(key, g, kspan, ev, &mut out)?;
        }
    }

    // Hooks
    if let Some(hooks_val) = cfg_map.get("hooks") {
        let hspan = span_of(ev, config, "hooks", config_span);
        let Value::Object(hooks) = hooks_val else {
            return Err(Diag::new(hspan, "`hooks` must be an object keyed by collection"));
        };
        for (key, per) in hooks.borrow().iter() {
            let kspan = span_of(ev, hooks_val, key, hspan);
            let Some(coll) = out.schema.by_key(key) else {
                let mut d = Diag::new(kspan, format!("`hooks.{key}` doesn't match a collection in `schema`"));
                let keys: Vec<&str> = out.schema.collections.values().map(|c| c.key.as_str()).collect();
                if let Some(s) = suggest(key, keys) {
                    d = d.help(format!("did you mean `{s}`?"));
                }
                return Err(d);
            };
            let table = coll.table.clone();
            let Value::Object(per_map) = per else {
                return Err(Diag::new(
                    kspan,
                    format!("`hooks.{key}` must be an object of hook functions"),
                ));
            };
            for (hname, f) in per_map.borrow().iter() {
                let fspan = span_of(ev, per, hname, kspan);
                let Some(kind) = HookKind::parse(hname) else {
                    let mut d = Diag::new(fspan, format!("there's no hook called `{hname}`"));
                    if let Some(s) = suggest(hname, HookKind::ALL.iter().map(|h| h.name())) {
                        d = d.help(format!("did you mean `{s}`?"));
                    }
                    return Err(d);
                };
                let Value::Closure(f) = f else {
                    return Err(Diag::new(
                        fspan,
                        format!("`{hname}` must be a function, not {}", f.describe()),
                    ));
                };
                if kind == HookKind::BeforeCreate {
                    let coll = out.schema.collections.get_mut(&table).expect("collection");
                    coll.before_create_fills = assigned_keys(f)
                        .into_iter()
                        .filter(|k| {
                            coll.columns
                                .get(k)
                                .is_some_and(|c| c.not_null && c.default.is_none() && !c.auto_increment)
                        })
                        .collect();
                }
                out.roots.push(Root {
                    closure: f.clone(),
                    slot: Slot::Hook {
                        table: table.clone(),
                        kind,
                    },
                    name: format!("{table}__{hname}"),
                });
            }
        }
    }

    // Actions
    if let Some(actions_val) = cfg_map.get("actions") {
        let aspan = span_of(ev, config, "actions", config_span);
        let Value::Object(actions) = actions_val else {
            return Err(Diag::new(aspan, "`actions` must be an object of action(...) values"));
        };
        for (name, a) in actions.borrow().iter() {
            let nspan = span_of(ev, actions_val, name, aspan);
            if !valid_ident(name) {
                return Err(Diag::new(nspan, format!("\"{name}\" isn't a valid action name")));
            }
            let Value::Action(a) = a else {
                return Err(Diag::new(
                    nspan,
                    format!("action `{name}` must be wrapped in action({{ input, handler }})"),
                ));
            };
            let Value::Object(cfg) = &a.config else { unreachable!() };
            let cfg = cfg.borrow().clone();
            for k in cfg.keys() {
                if !matches!(k.as_str(), "input" | "handler" | "access") {
                    return Err(Diag::new(
                        ev.key_span(&a.config, k).unwrap_or(a.span),
                        format!("action() has no option `{k}`"),
                    )
                    .help("use input, handler, access"));
                }
            }
            let owner = Owner::Action(name.clone());
            let mut input = IndexMap::new();
            if let Some(iv) = cfg.get("input") {
                let Value::Object(fields) = iv else {
                    return Err(Diag::new(a.span, "`input` must be an object of columns"));
                };
                for (field, fv) in fields.borrow().iter() {
                    let fspan = ev.key_span(iv, field).unwrap_or(a.span);
                    let Value::Column(b) = fv else {
                        return Err(
                            Diag::new(fspan, format!("input `{field}` is {}, not a column", fv.describe()))
                                .help("describe inputs with integer(), text(), ..."),
                        );
                    };
                    let col = column(field, b, &owner, &[], Place::Input, ev, &mut out)?;
                    input.insert(field.clone(), col);
                }
            }
            let Some(Value::Closure(handler)) = cfg.get("handler") else {
                return Err(Diag::new(a.span, format!("action `{name}` needs a `handler` function")));
            };
            let access = match cfg.get("access") {
                None | Some(Value::Undef) => Access::editor(),
                Some(v) => {
                    let sp = ev.key_span(&a.config, "access").unwrap_or(a.span);
                    access_rule(v, sp, &owner, "access", format!("action__{name}__access"), &mut out)?
                }
            };
            out.roots.push(Root {
                closure: handler.clone(),
                slot: Slot::ActionHandler { action: name.clone() },
                name: format!("action__{name}"),
            });
            out.schema.actions.insert(
                name.clone(),
                Action {
                    name: name.clone(),
                    input,
                    handler: String::new(),
                    access,
                },
            );
        }
    }
    Ok(out)
}

fn valid_ident(s: &str) -> bool {
    let mut chars = s.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic()) && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && s.split('-')
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()))
}

/// A project directory name as a plugin slug: "My Blog_2" → "my-blog-2".
pub fn slugify_name(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "app".into() } else { out }
}

struct CollOpts {
    label: String,
    editor: bool,
    drafts: bool,
    revisions: bool,
    title: Option<String>,
    content: Option<String>,
    slug: Option<String>,
    access: IndexMap<String, Access>,
    api: Api,
}

fn collection_options(
    c: &CollectionVal,
    columns: &IndexMap<String, Column>,
    ev: &Evaluator<'_>,
    out: &mut Extracted,
) -> Result<CollOpts> {
    let mut api = Api {
        list: true,
        get: true,
        create: true,
        update: true,
        delete: true,
    };
    let empty = Value::object(IndexMap::new());
    let opts_val = c.options.clone().unwrap_or(empty);
    let Value::Object(o) = &opts_val else { unreachable!() };
    let o = o.borrow().clone();
    let span = |k: &str| ev.key_span(&opts_val, k).unwrap_or(c.span);
    let flag = |k: &str| -> Result<Option<bool>> {
        match o.get(k) {
            None | Some(Value::Undef) => Ok(None),
            Some(Value::Bool(b)) => Ok(Some(*b)),
            Some(other) => Err(Diag::new(
                span(k),
                format!("`{k}` must be true or false, not {}", other.describe()),
            )),
        }
    };
    let name_opt = |k: &str| -> Result<Option<String>> {
        match o.get(k) {
            None | Some(Value::Undef) => Ok(None),
            Some(Value::Str(s)) => Ok(Some(s.to_string())),
            Some(other) => Err(Diag::new(
                span(k),
                format!("`{k}` must be a column name, not {}", other.describe()),
            )),
        }
    };
    for k in o.keys() {
        if !COLLECTION_OPTIONS.contains(&k.as_str()) {
            let mut d = Diag::new(span(k), format!("collection() has no option `{k}`"));
            if let Some(s) = suggest(k, COLLECTION_OPTIONS.iter().copied()) {
                d = d.help(format!("did you mean `{s}`?"));
            }
            return Err(d);
        }
    }
    let label = match o.get("label") {
        None | Some(Value::Undef) => title_case(&c.table),
        Some(Value::Str(s)) => s.to_string(),
        Some(other) => {
            return Err(Diag::new(
                span("label"),
                format!("`label` must be a string, not {}", other.describe()),
            ));
        }
    };
    let editor = flag("editor")?.unwrap_or(true);
    let drafts = match flag("drafts")? {
        Some(false) if editor => {
            return Err(Diag::new(span("drafts"), "`drafts: false` needs `editor: false`")
                .help("WordPress posts always have a status; set `editor: false` for a plain table"));
        }
        Some(d) => d,
        None => editor,
    };
    let revisions = flag("revisions")?.unwrap_or(editor);

    if editor && c.table.len() > MAX_POST_TYPE_TABLE {
        return Err(Diag::new(
            c.span,
            format!(
                "\"{}\" is too long for an editor collection: WordPress post types are limited to 20 characters and Zero prefixes `zero_`",
                c.table
            ),
        )
        .help(format!(
            "use a name of at most {MAX_POST_TYPE_TABLE} characters, or set `editor: false`"
        )));
    }
    if editor
        && let Some(pk) = columns.values().find(|c| c.primary_key)
        && !(pk.ty == ColType::Integer && pk.auto_increment)
    {
        return Err(Diag::new(
            c.columns[&pk.name].span,
            format!(
                "\"{}\" is an editor collection, so its primary key is the WordPress post ID",
                c.table
            ),
        )
        .help("use `id: id()`, or set `editor: false`"));
    }

    // title
    let explicit_title = name_opt("title")?;
    let title = match &explicit_title {
        Some(t) => Some(t.clone()),
        None => columns
            .get("title")
            .filter(|col| col.ty == ColType::Text && editor)
            .map(|col| col.name.clone()),
    };
    if let Some(t) = &title {
        let sp = if explicit_title.is_some() {
            span("title")
        } else {
            c.columns[t].span
        };
        match columns.get(t) {
            None => return Err(no_column(&c.table, t, columns, sp, "title")),
            Some(col) if !(col.ty == ColType::Text && col.not_null) => {
                return Err(Diag::new(
                    sp,
                    format!(
                        "the title column `{t}` must be a notNull text(), but it's {}",
                        describe_col(col)
                    ),
                )
                .help(format!("declare it as `{t}: text().notNull()`")));
            }
            _ => {}
        }
    } else if editor {
        return Err(
            Diag::new(c.span, format!("editor collection \"{}\" has no title", c.table))
                .help("add a `title: text().notNull()` column or `title:` option, or set `editor: false`"),
        );
    }

    // content
    let explicit_content = name_opt("content")?;
    let content = match &explicit_content {
        Some(t) => Some(t.clone()),
        None => columns
            .get("content")
            .filter(|col| col.ty == ColType::RichText)
            .map(|col| col.name.clone()),
    };
    if let Some(t) = &content {
        let sp = span("content");
        match columns.get(t) {
            None => return Err(no_column(&c.table, t, columns, sp, "content")),
            Some(col) if col.ty != ColType::RichText => {
                return Err(Diag::new(
                    sp,
                    format!(
                        "the content column `{t}` must be richText(), but it's {}",
                        describe_col(col)
                    ),
                ));
            }
            _ => {}
        }
    }

    // slug
    let slugs: Vec<&Column> = columns.values().filter(|c| c.ty == ColType::Slug).collect();
    if slugs.len() > 1 {
        return Err(Diag::new(
            c.columns[&slugs[1].name].span,
            format!("\"{}\" has more than one slug() column", c.table),
        )
        .help("a collection has at most one slug; use text() for the others"));
    }
    let slug = slugs.first().map(|s| s.name.clone());
    if let Some(s) = slugs.first()
        && let Some(src) = &s.source
    {
        let sp = c.columns[&s.name].span;
        match columns.get(src) {
            None => return Err(no_column(&c.table, src, columns, sp, "slug source")),
            Some(col) if col.ty != ColType::Text => {
                return Err(Diag::new(
                    sp,
                    format!(
                        "slug source `{src}` must be a text() column, but it's {}",
                        describe_col(col)
                    ),
                ));
            }
            _ => {}
        }
    }

    // drafts system columns
    if drafts {
        for reserved in ["status", "publishedAt"] {
            if let Some(b) = c.columns.get(reserved) {
                return Err(Diag::new(
                    b.span,
                    format!("`{reserved}` is reserved: drafts add these (status, publishedAt)"),
                )
                .help("rename the column, or set `drafts: false` with `editor: false`"));
            }
        }
    }

    // access
    let owner = Owner::Collection(c.table.clone());
    let mut access: IndexMap<String, Access> = ACCESS_OPS
        .iter()
        .map(|op| {
            (
                op.to_string(),
                if *op == "read" {
                    Access::anyone()
                } else {
                    Access::editor()
                },
            )
        })
        .collect();
    if let Some(av) = o.get("access").filter(|v| !matches!(v, Value::Undef)) {
        let Value::Object(am) = av else {
            return Err(Diag::new(
                span("access"),
                "`access` must be an object like `{ read: \"anyone\", create: \"editor\" }`",
            ));
        };
        for (op, rule) in am.borrow().iter() {
            let sp = ev.key_span(av, op).unwrap_or(span("access"));
            if !ACCESS_OPS.contains(&op.as_str()) {
                let mut d = Diag::new(sp, format!("`access` has no operation `{op}`"));
                if let Some(s) = suggest(op, ACCESS_OPS.iter().copied()) {
                    d = d.help(format!("did you mean `{s}`?"));
                } else {
                    d = d.help("use read, create, update, delete");
                }
                return Err(d);
            }
            let name = format!("{}__access__{op}", c.table);
            access.insert(op.clone(), access_rule(rule, sp, &owner, op, name, out)?);
        }
    }

    // api
    if let Some(v) = o.get("api").filter(|v| !matches!(v, Value::Undef)) {
        let Value::Object(flags) = v else {
            return Err(Diag::new(
                span("api"),
                "`api` must be an object like `{ delete: false }`",
            ));
        };
        for (fk, fv) in flags.borrow().iter() {
            let Value::Bool(b) = fv else {
                return Err(Diag::new(span("api"), format!("`api.{fk}` must be true or false")));
            };
            match fk.as_str() {
                "list" => api.list = *b,
                "get" => api.get = *b,
                "create" => api.create = *b,
                "update" => api.update = *b,
                "delete" => api.delete = *b,
                other => {
                    return Err(Diag::new(span("api"), format!("`api` has no flag `{other}`"))
                        .help("use list, get, create, update, delete"));
                }
            }
        }
    }
    Ok(CollOpts {
        label,
        editor,
        drafts,
        revisions,
        title,
        content,
        slug,
        access,
        api,
    })
}

fn no_column(table: &str, name: &str, columns: &IndexMap<String, Column>, span: Span, what: &str) -> Diag {
    let mut d = Diag::new(span, format!("{what} `{name}` isn't a column of \"{table}\""));
    if let Some(s) = suggest(name, columns.keys().map(String::as_str)) {
        d = d.help(format!("did you mean `{s}`?"));
    }
    d
}

fn describe_col(c: &Column) -> String {
    let mut s = kind_phrase(c.ty);
    if !c.not_null && c.ty == ColType::Text {
        s = format!("a nullable {}", &s[2..]);
    }
    s
}

/// One rule (§1.6): boolean, "anyone", "authenticated", a role, or a function.
fn access_rule(v: &Value, span: Span, owner: &Owner, op: &str, fn_name: String, out: &mut Extracted) -> Result<Access> {
    Ok(match v {
        Value::Bool(b) => Access::Allow(*b),
        Value::Str(s) if &**s == "anyone" || &**s == "authenticated" || ROLES.contains(&&**s) => {
            Access::Role(s.to_string())
        }
        Value::Closure(f) => {
            out.roots.push(Root {
                closure: f.clone(),
                slot: Slot::Access {
                    owner: owner.clone(),
                    op: op.to_string(),
                },
                name: fn_name,
            });
            Access::Fn(String::new())
        }
        other => {
            let mut d = Diag::new(span, format!("{} isn't an access rule", other.describe()));
            let names = ["anyone", "authenticated", "subscriber", "author", "editor", "admin"];
            match other {
                Value::Str(s) if suggest(s, names).is_some() => {
                    d = d.help(format!("did you mean \"{}\"?", suggest(s, names).expect("suggestion")));
                }
                _ => {
                    d = d.help(
                        "use true/false, \"anyone\", \"authenticated\", a role (\"subscriber\", \"author\", \"editor\", \"admin\"), or (ctx) => ...",
                    )
                }
            }
            return Err(d);
        }
    })
}

fn global(key: &str, g: &GlobalVal, span: Span, ev: &mut Evaluator<'_>, out: &mut Extracted) -> Result<()> {
    if g.name != key {
        return Err(Diag::new(
            span,
            format!(
                "`globals.{key}` holds global(\"{}\"); the key and the name must match",
                g.name
            ),
        )
        .help(format!("write `{0}: global(\"{0}\", ...)`", key)));
    }
    if !valid_ident(key) {
        return Err(Diag::new(g.span, format!("\"{key}\" isn't a valid global name")));
    }
    let owner = Owner::Global(key.to_string());
    let mut fields = IndexMap::new();
    for (name, b) in &g.fields {
        let col = column(name, b, &owner, &[], Place::Global, ev, out)?;
        if col.not_null && col.default.is_none() {
            return Err(Diag::new(
                b.span,
                format!("global fields that are notNull need a default (`{name}`)"),
            )
            .help("add `.default(...)`, or drop `.notNull()`"));
        }
        fields.insert(name.clone(), col);
    }
    let mut label = title_case(key);
    let mut access: IndexMap<String, Access> = [
        ("read".to_string(), Access::anyone()),
        ("update".to_string(), Access::editor()),
    ]
    .into_iter()
    .collect();
    if let Some(opts) = &g.options {
        let Value::Object(o) = opts else { unreachable!() };
        for (k, v) in o.borrow().iter() {
            let sp = ev.key_span(opts, k).unwrap_or(g.span);
            match (k.as_str(), v) {
                ("label", Value::Str(s)) => label = s.to_string(),
                ("access", Value::Object(am)) => {
                    for (op, rule) in am.borrow().iter() {
                        let osp = ev.key_span(v, op).unwrap_or(sp);
                        if op != "read" && op != "update" {
                            return Err(Diag::new(osp, format!("global access has no operation `{op}`"))
                                .help("globals have read and update"));
                        }
                        let rule = access_rule(rule, osp, &owner, op, format!("global__{key}__access__{op}"), out)?;
                        access.insert(op.clone(), rule);
                    }
                }
                ("label" | "access", other) => {
                    return Err(Diag::new(sp, format!("`{k}` can't be {}", other.describe())));
                }
                _ => {
                    return Err(Diag::new(sp, format!("global() has no option `{k}`")).help("use label, access"));
                }
            }
        }
    }
    out.schema.globals.insert(
        key.to_string(),
        Global {
            name: key.to_string(),
            label,
            fields,
            access,
        },
    );
    Ok(())
}

/// §3.5.1: a hint per post-backed column that only postmeta can filter.
fn postmeta_hints(out: &mut Extracted) {
    let mut hints = Vec::new();
    for c in out.schema.collections.values() {
        for col in c.columns.values() {
            if !c.editor || c.is_core_column(&col.name) {
                continue;
            }
            if col.unique || col.references.is_some() {
                hints.push((c.table.clone(), col.name.clone()));
            }
        }
        for col in c.columns.values() {
            if let Some(r) = &col.references
                && let Some(t) = out.schema.collections.get(&r.collection)
                && t.editor
                && !t.is_core_column(&r.column)
            {
                hints.push((t.table.clone(), r.column.clone()));
            }
        }
    }
    for (t, col) in hints {
        let h = format!(
            "\"{t}.{col}\" is filtered through postmeta on WordPress; set editor: false on \"{t}\" if this list grows large"
        );
        if !out.hints.contains(&h) {
            out.hints.push(h);
        }
    }
}

fn column(
    name: &str,
    b: &ColBuilder,
    owner: &Owner,
    parent: &[String],
    place: Place,
    ev: &mut Evaluator<'_>,
    out: &mut Extracted,
) -> Result<Column> {
    if !valid_ident(name) {
        return Err(Diag::new(b.span, format!("\"{name}\" isn't a valid column name"))
            .help("use letters, digits, and underscores, starting with a letter"));
    }
    let mut path = parent.to_vec();
    path.push(name.to_string());
    let at = ColPath {
        owner: owner.clone(),
        path: path.clone(),
    };
    let outer = place != Place::Top;
    // Builders and modifiers that only make sense on a top-level collection column.
    let forbidden: Option<(&str, Span)> = if !outer {
        None
    } else if b.primary_key {
        Some(("id() / .primaryKey()", b.span_of("primaryKey")))
    } else if b.unique && b.ty != ColType::Slug {
        Some(("`.unique()`", b.span_of("unique")))
    } else if b.references.is_some() {
        Some(("`.references()`", b.span_of("references")))
    } else if b.on_update.is_some() {
        Some(("`.$onUpdate()`", b.span_of("$onUpdate")))
    } else if b.ty == ColType::Slug {
        Some(("slug()", b.span))
    } else if b.ty == ColType::Blocks {
        Some(("blocks()", b.span))
    } else {
        None
    };
    if let Some((what, sp)) = forbidden {
        return Err(Diag::new(sp, format!("{what} isn't allowed {} (`{name}`)", place.where_()))
            .help(match place {
                Place::Sub(_) => "sub-fields hold plain values; keep ids, uniqueness, references, slugs, and blocks on collection columns",
                Place::Global => "globals are one record; keep ids, uniqueness, references, slugs, and blocks on collections",
                _ => "describe inputs with plain builders: integer(), text(), group(), ...",
            }));
    }
    if b.ty.is_structured() && place.depth() > MAX_NESTING {
        return Err(Diag::new(
            b.span,
            format!("`{name}` nests too deep: group and repeater fields go at most {MAX_NESTING} levels deep"),
        )
        .help("flatten the structure, or move it to its own collection"));
    }
    if b.unique && b.ty != ColType::Slug && b.ty.is_stringy() && b.max.is_none_or(|m| m > MAX_UNIQUE_TEXT) {
        return Err(Diag::new(
            b.span_of("unique"),
            format!("unique text columns are limited to 191 characters on MySQL (`{name}`); add `.max(191)`"),
        )
        .help("add `.max(191)` (or a smaller limit)"));
    }
    if let (Some(min), Some(max)) = (b.min, b.max)
        && min > max
    {
        return Err(Diag::new(
            b.span_of("min"),
            format!("`{name}` has `.min({min})` larger than `.max({max})`"),
        ));
    }

    let default = match &b.default {
        None => None,
        Some(DefaultVal::Now) => Some(DefaultKind::Now),
        Some(DefaultVal::Fn(f)) => {
            out.roots.push(Root {
                closure: f.clone(),
                slot: Slot::Default { at: at.clone() },
                name: fn_name(owner, "default", &path),
            });
            Some(DefaultKind::Fn(String::new()))
        }
        Some(DefaultVal::Value(v)) => Some(DefaultKind::Value(check_value(name, b, v)?)),
    };
    let on_update = match &b.on_update {
        None => None,
        Some(DefaultVal::Now) => Some(DefaultKind::Now),
        Some(DefaultVal::Fn(f)) => {
            out.roots.push(Root {
                closure: f.clone(),
                slot: Slot::OnUpdate { at: at.clone() },
                name: fn_name(owner, "onUpdate", &path),
            });
            Some(DefaultKind::Fn(String::new()))
        }
        Some(DefaultVal::Value(_)) => unreachable!("$onUpdate always takes a function"),
    };
    let references = match &b.references {
        None => None,
        Some((f, on_delete, on_update, span)) => {
            let target = ev.call_closure_public(f, vec![], *span)?;
            let Value::ColRef(r) = target else {
                return Err(Diag::new(
                    *span,
                    format!(
                        "`references(() => ...)` must return a column like `locations.id`, not {}",
                        target.describe()
                    ),
                ));
            };
            if !out.collections.iter().any(|c| Rc::ptr_eq(c, &r.collection)) {
                return Err(Diag::new(
                    *span,
                    format!(
                        "`{name}` references collection \"{}\", which isn't in `schema`",
                        r.collection.table
                    ),
                ));
            }
            let target_col = &r.collection.columns[&r.column];
            if target_col.ty != b.ty {
                return Err(Diag::new(
                    *span,
                    format!(
                        "`{name}` is {}() but references {}.{}, which is {}()",
                        b.ty.name(),
                        r.collection.table,
                        r.column,
                        target_col.ty.name()
                    ),
                ));
            }
            if !target_col.primary_key && !target_col.unique {
                return Err(Diag::new(
                    *span,
                    format!(
                        "{}.{} must be a primary key or unique to be referenced",
                        r.collection.table, r.column
                    ),
                ));
            }
            if *on_delete == Some(RefAction::SetNull) && b.not_null {
                return Err(Diag::new(
                    *span,
                    format!("`{name}` is notNull(), so `onDelete: \"set null\"` can't work"),
                ));
            }
            Some(Reference {
                collection: r.collection.table.clone(),
                column: r.column.clone(),
                on_delete: *on_delete,
                on_update: *on_update,
            })
        }
    };
    let validate = match &b.validate {
        Some(f) => {
            out.roots.push(Root {
                closure: f.clone(),
                slot: Slot::Validate { at: at.clone() },
                name: fn_name(owner, "validate", &path),
            });
            Some(String::new())
        }
        None => None,
    };
    let sub_place = Place::Sub(place.depth() + 1);
    let fields = match &b.fields {
        None => None,
        Some(fs) => {
            let mut m = IndexMap::new();
            for (k, fb) in fs {
                m.insert(k.clone(), column(k, fb, owner, &path, sub_place, ev, out)?);
            }
            Some(m)
        }
    };
    let layouts = match &b.layouts {
        None => None,
        Some(ls) => {
            let mut m = IndexMap::new();
            for (lname, fs) in ls {
                if !valid_ident(lname) {
                    return Err(Diag::new(b.span, format!("\"{lname}\" isn't a valid layout name")));
                }
                let mut lpath = path.clone();
                lpath.push(lname.clone());
                let mut fm = IndexMap::new();
                for (k, fb) in fs {
                    if k == "layout" {
                        return Err(Diag::new(
                            fb.span,
                            format!("`layout` is reserved in blocks items (layout `{lname}`)"),
                        )
                        .help("each item's `layout` key names its layout; rename the field"));
                    }
                    fm.insert(k.clone(), column(k, fb, owner, &lpath, sub_place, ev, out)?);
                }
                m.insert(lname.clone(), fm);
            }
            Some(m)
        }
    };
    Ok(Column {
        name: name.to_string(),
        ty: b.ty,
        not_null: b.not_null,
        primary_key: b.primary_key,
        auto_increment: b.auto_increment,
        unique: b.unique,
        enum_values: b.enum_values.clone(),
        multiline: b.multiline,
        accept: b.accept.clone(),
        source: b.source.clone(),
        default,
        on_update,
        references,
        rules: Rules {
            min: b.min,
            max: b.max,
            pattern: b.pattern.clone(),
            validate,
        },
        fields,
        layouts,
        system: false,
        ts_type: b.ts_type.clone(),
    })
}

/// `posts__validate__seo__metaTitle`, `global__settings__default__x`, `action__a__default__x`.
fn fn_name(owner: &Owner, what: &str, path: &[String]) -> String {
    let base = match owner {
        Owner::Collection(t) => t.clone(),
        Owner::Global(g) => format!("global__{g}"),
        Owner::Action(a) => format!("action__{a}"),
    };
    format!("{base}__{what}__{}", path.join("__"))
}

/// Validates a constant default against its column and returns it as JSON.
fn check_value(name: &str, b: &ColBuilder, v: &Value) -> Result<Json> {
    let span = b.span_of("default");
    let bad = |what: &str| -> Result<Json> {
        Err(Diag::new(
            span,
            format!("`{name}` defaults to {}, but it's {what}", v.describe()),
        ))
    };
    if matches!(v, Value::Null | Value::Undef) {
        if b.not_null {
            return bad("notNull()");
        }
        return Ok(Json::Null);
    }
    let in_enum = |s: &str| b.enum_values.as_ref().is_none_or(|e| e.iter().any(|x| x == s));
    match (b.ty, v) {
        (ColType::Integer, Value::Num(n)) if n.fract() == 0.0 && n.is_finite() => {}
        (ColType::Integer, _) => return bad("an integer column"),
        (ColType::Real, Value::Num(n)) if n.is_finite() => {}
        (ColType::Real, _) => return bad("a real column"),
        (ColType::Boolean, Value::Bool(_)) => {}
        (ColType::Boolean, _) => return bad("a boolean column"),
        (ColType::Text, Value::Str(s)) => {
            if !in_enum(s) {
                return Err(Diag::new(
                    span,
                    format!(
                        "`{name}` defaults to \"{s}\", which isn't one of {}",
                        b.enum_values.as_ref().expect("enum").join(", ")
                    ),
                ));
            }
        }
        (ColType::Email | ColType::Url | ColType::Slug | ColType::RichText, Value::Str(_)) => {}
        (ColType::Text | ColType::Email | ColType::Url | ColType::Slug | ColType::RichText, _) => {
            return bad(&kind_phrase(b.ty));
        }
        (ColType::Date, Value::Str(s)) if is_date(s) => {}
        (ColType::Date, _) => return bad("a date column (use \"YYYY-MM-DD\" or .defaultNow())"),
        (ColType::Timestamp, Value::Str(_)) => {}
        (ColType::Timestamp, _) => return bad("a timestamp column (use an ISO string or .defaultNow())"),
        (ColType::Json, _) => {}
        (ColType::Media, _) => return bad("a media column"),
        (ColType::MediaList, Value::Array(a)) => {
            if !a
                .borrow()
                .iter()
                .all(|x| matches!(x, Value::Num(n) if n.fract() == 0.0))
            {
                return bad("a list of media ids");
            }
        }
        (ColType::Select, Value::Array(a)) => {
            for x in a.borrow().iter() {
                match x {
                    Value::Str(s) if in_enum(s) => {}
                    _ => {
                        return Err(Diag::new(
                            span,
                            format!(
                                "`{name}` defaults to {}, but every item must be one of {}",
                                v.describe(),
                                b.enum_values.as_ref().map(|e| e.join(", ")).unwrap_or_default()
                            ),
                        ));
                    }
                }
            }
        }
        (ColType::Repeater | ColType::Blocks, Value::Array(_)) => {}
        (ColType::Group, Value::Object(_)) => {}
        (ColType::MediaList | ColType::Select | ColType::Repeater | ColType::Blocks, _) => {
            return bad("a list column (use an array)");
        }
        (ColType::Group, _) => return bad("a group column (use an object)"),
    }
    to_json(v).ok_or_else(|| {
        Diag::new(
            span,
            format!("`{name}` defaults to {}, which isn't plain data", v.describe()),
        )
    })
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && s.chars()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn relations(rel: &Value, ev: &Evaluator<'_>, out: &mut Extracted, span: Span) -> Result<()> {
    let Value::Object(o) = rel else {
        return Err(Diag::new(
            span,
            "`relations` must come from defineRelations(schema, (r) => ({ ... }))",
        ));
    };
    let o = o.borrow();
    if !matches!(o.get("$zeroRelations"), Some(Value::Bool(true))) {
        return Err(Diag::new(
            span,
            "`relations` must come from defineRelations(schema, (r) => ({ ... }))",
        ));
    }
    let defs_val = o.get("relations").cloned().unwrap_or(Value::Undef);
    let Value::Object(defs) = &defs_val else {
        return Err(Diag::new(
            span,
            "the defineRelations() callback must return an object keyed by collection",
        ));
    };
    let col_ref = |v: Option<&Value>, what: &str, rspan: Span| -> Result<Option<(String, String)>> {
        match v {
            None | Some(Value::Undef) => Ok(None),
            Some(Value::ColRef(r)) => Ok(Some((r.collection.table.clone(), r.column.clone()))),
            Some(other) => Err(Diag::new(
                rspan,
                format!(
                    "`{what}` must be a column like `r.items.locationId`, not {}",
                    other.describe()
                ),
            )),
        }
    };
    let mut pending_many = Vec::new();
    for (key, rels) in defs.borrow().iter() {
        let kspan = ev.key_span(&defs_val, key).unwrap_or(span);
        let Some(coll) = out.schema.by_key(key) else {
            return Err(Diag::new(
                kspan,
                format!("relations for `{key}`, which isn't in `schema`"),
            ));
        };
        let table = coll.table.clone();
        let Value::Object(rels_map) = rels else {
            return Err(Diag::new(kspan, format!("relations for `{key}` must be an object")));
        };
        for (rname, rv) in rels_map.borrow().iter() {
            let rspan = ev.key_span(rels, rname).unwrap_or(kspan);
            let Value::Relation(r) = rv else {
                return Err(Diag::new(
                    rspan,
                    format!("`{rname}` must be r.one.<collection>(...) or r.many.<collection>(...)"),
                ));
            };
            if out.schema.collections[&table].columns.contains_key(rname) {
                return Err(Diag::new(
                    rspan,
                    format!("relation `{rname}` has the same name as a column of \"{table}\""),
                ));
            }
            let target = out
                .schema
                .by_key(&r.target)
                .expect("relation targets come from schema keys")
                .table
                .clone();
            let (mut from, mut to, mut optional) = (None, None, true);
            if let Some(cfg_val) = &r.config {
                let Value::Object(cfg) = cfg_val else { unreachable!() };
                for (k, v) in cfg.borrow().iter() {
                    match k.as_str() {
                        "from" => from = col_ref(Some(v), "from", rspan)?,
                        "to" => to = col_ref(Some(v), "to", rspan)?,
                        "optional" => match v {
                            Value::Bool(b) => optional = *b,
                            _ => return Err(Diag::new(rspan, "`optional` must be true or false")),
                        },
                        other => {
                            return Err(Diag::new(rspan, format!("relations have no option `{other}`"))
                                .help("use from, to, optional"));
                        }
                    }
                }
            }
            match (r.kind, from, to) {
                (RelKind::One, Some((ft, fc)), Some((tt, tc))) => {
                    if ft != table || tt != target {
                        return Err(Diag::new(
                            rspan,
                            format!("`{rname}` must go from a column of \"{table}\" to a column of \"{target}\""),
                        ));
                    }
                    out.schema
                        .collections
                        .get_mut(&table)
                        .expect("collection")
                        .relations
                        .insert(
                            rname.clone(),
                            Relation {
                                name: rname.clone(),
                                kind: RelKind::One,
                                collection: target,
                                from: fc,
                                to: tc,
                                optional,
                            },
                        );
                }
                (RelKind::One, _, _) => {
                    return Err(
                        Diag::new(rspan, format!("`{rname}` needs `from` and `to`")).help(format!(
                            "r.one.{}({{ from: r.{key}.someId, to: r.{}.id }})",
                            r.target, r.target
                        )),
                    );
                }
                (RelKind::Many, Some((ft, fc)), Some((tt, tc))) => {
                    if ft != table || tt != target {
                        return Err(Diag::new(
                            rspan,
                            format!("`{rname}` must go from a column of \"{table}\" to a column of \"{target}\""),
                        ));
                    }
                    out.schema
                        .collections
                        .get_mut(&table)
                        .expect("collection")
                        .relations
                        .insert(
                            rname.clone(),
                            Relation {
                                name: rname.clone(),
                                kind: RelKind::Many,
                                collection: target,
                                from: fc,
                                to: tc,
                                optional: false,
                            },
                        );
                }
                (RelKind::Many, None, None) => pending_many.push((table.clone(), rname.clone(), target, rspan)),
                (RelKind::Many, _, _) => {
                    return Err(Diag::new(
                        rspan,
                        format!("`{rname}` needs both `from` and `to`, or neither"),
                    ));
                }
            }
        }
    }
    // `r.many.x()` with no config mirrors the one `r.one` pointing back.
    for (table, rname, target, rspan) in pending_many {
        let back: Vec<&Relation> = out.schema.collections[&target]
            .relations
            .values()
            .filter(|r| r.kind == RelKind::One && r.collection == table)
            .collect();
        let (from, to) = match back.as_slice() {
            [one] => (one.to.clone(), one.from.clone()),
            [] => {
                return Err(Diag::new(
                    rspan,
                    format!("can't infer `{rname}`: \"{target}\" has no r.one relation pointing at \"{table}\""),
                )
                .help("add `from` and `to`"));
            }
            _ => {
                return Err(Diag::new(
                    rspan,
                    format!("can't infer `{rname}`: \"{target}\" has several relations pointing at \"{table}\""),
                )
                .help("add `from` and `to`"));
            }
        };
        out.schema
            .collections
            .get_mut(&table)
            .expect("collection")
            .relations
            .insert(
                rname.clone(),
                Relation {
                    name: rname,
                    kind: RelKind::Many,
                    collection: target,
                    from,
                    to,
                    optional: false,
                },
            );
    }
    Ok(())
}

/// Keys the function assigns on its first parameter (`data.slug = ...`).
pub fn assigned_keys(f: &Closure) -> Vec<String> {
    let Some(Pat::Id(param, _)) = f.func.params.first().map(|p| &p.pat) else {
        return vec![];
    };
    let mut out = Vec::new();
    match &f.func.body {
        FnBody::Expr(e) => scan_expr(e, param, &mut out),
        FnBody::Block(b) => scan_stmts(b, param, &mut out),
    }
    out
}

fn scan_stmts(stmts: &[Stmt], param: &str, out: &mut Vec<String>) {
    for s in stmts {
        match s {
            Stmt::Expr(e) | Stmt::Throw(e) => scan_expr(e, param, out),
            Stmt::Return(Some(e), _) => scan_expr(e, param, out),
            Stmt::Decl { init: Some(e), .. } => scan_expr(e, param, out),
            Stmt::If(t, a, b) => {
                scan_expr(t, param, out);
                scan_stmts(a, param, out);
                if let Some(b) = b {
                    scan_stmts(b, param, out);
                }
            }
            Stmt::Block(b) | Stmt::While(_, b) => scan_stmts(b, param, out),
            Stmt::For { body, .. } | Stmt::ForOf { body, .. } => scan_stmts(body, param, out),
            Stmt::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                scan_stmts(block, param, out);
                if let Some(h) = handler {
                    scan_stmts(h, param, out);
                }
                if let Some(f) = finalizer {
                    scan_stmts(f, param, out);
                }
            }
            Stmt::Switch { cases, .. } => {
                for (_, b) in cases {
                    scan_stmts(b, param, out);
                }
            }
            _ => {}
        }
    }
}

/// `data.slug = slugify(data.name)` fills `slug`; `data.name = data.name.trim()`
/// only rewrites `name`, which the writer must still provide.
fn scan_expr(e: &crate::ir::Expr, param: &str, out: &mut Vec<String>) {
    if let ExprKind::Assign {
        op: None,
        target,
        value,
    } = &e.kind
        && let ExprKind::Member { obj, prop, .. } = &target.kind
        && matches!(&obj.kind, ExprKind::Ident(n) if n == param)
        && !reads_key(value, param, prop)
        && !out.contains(prop)
    {
        out.push(prop.clone());
    }
}

fn reads_key(e: &crate::ir::Expr, param: &str, key: &str) -> bool {
    use crate::ir::{ArrEl, Prop};
    let r = |x: &crate::ir::Expr| reads_key(x, param, key);
    match &e.kind {
        ExprKind::Member { obj, prop, .. } => match &obj.kind {
            ExprKind::Ident(n) if n == param => prop == key,
            _ => r(obj),
        },
        ExprKind::Ident(n) => n == param,
        ExprKind::Call { callee, args, .. } | ExprKind::New { callee, args } => {
            r(callee)
                || args
                    .iter()
                    .any(|a| matches!(a, ArrEl::Item(x) | ArrEl::Spread(x) if r(x)))
        }
        ExprKind::Binary(_, a, b) | ExprKind::Logical(_, a, b) => r(a) || r(b),
        ExprKind::Cond(a, b, c) => r(a) || r(b) || r(c),
        ExprKind::Unary(_, x)
        | ExprKind::Await(x)
        | ExprKind::Chain(x)
        | ExprKind::As(x, _)
        | ExprKind::NonNull(x)
        | ExprKind::IsNullish(x, _) => r(x),
        ExprKind::Index { obj, index, .. } => r(obj) || r(index),
        ExprKind::Template(_, xs) => xs.iter().any(r),
        ExprKind::Array(items) => items
            .iter()
            .any(|a| matches!(a, ArrEl::Item(x) | ArrEl::Spread(x) if r(x))),
        ExprKind::Object(props) => props.iter().any(|p| match p {
            Prop::KV(_, x) | Prop::Spread(x) => r(x),
        }),
        _ => false,
    }
}
