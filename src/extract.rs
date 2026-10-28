//! Reads the schema out of the evaluated config value and lists the functions
//! (hooks, actions, `$default`/`$onUpdate` callbacks) the PHP compiler must emit.

use crate::diag::{Diag, Result, Span, suggest};
use crate::eval::{Evaluator, to_json};
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
    Default { table: String, column: String },
    OnUpdate { table: String, column: String },
    ActionHandler { action: String },
    ActionDefault { action: String, field: String },
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
}

const CONFIG_KEYS: &[&str] = &["schema", "relations", "hooks", "actions"];

pub fn extract(config: &Value, ev: &mut Evaluator<'_>, config_span: Span) -> Result<Extracted> {
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
    };

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
        out.collections.push(c.clone());
        out.schema.collections.insert(
            c.table.clone(),
            Collection {
                key: key.clone(),
                table: c.table.clone(),
                columns: IndexMap::new(),
                relations: IndexMap::new(),
                hooks: IndexMap::new(),
                before_create_fills: Vec::new(),
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
        let mut columns = IndexMap::new();
        for (name, b) in &c.columns {
            if !valid_ident(name) {
                return Err(Diag::new(b.span, format!("\"{name}\" isn't a valid column name")));
            }
            let col = column(name, b, &c.table, ev, &out, &mut out.roots.clone())?;
            columns.insert(name.clone(), col);
        }
        let pks = columns.values().filter(|c| c.primary_key).count();
        if pks == 0 {
            return Err(
                Diag::new(c.span, format!("collection \"{}\" has no primary key", c.table)).help("add `id: id()`"),
            );
        }
        if pks > 1 {
            return Err(Diag::new(
                c.span,
                format!("collection \"{}\" has more than one primary key", c.table),
            ));
        }
        let api = api_options(&c, ev)?;
        let coll = out.schema.collections.get_mut(&c.table).expect("collection");
        coll.columns = columns;
        coll.api = api;
        for (name, b) in &c.columns {
            for (default, slot) in [
                (
                    &b.default,
                    Slot::Default {
                        table: c.table.clone(),
                        column: name.clone(),
                    },
                ),
                (
                    &b.on_update,
                    Slot::OnUpdate {
                        table: c.table.clone(),
                        column: name.clone(),
                    },
                ),
            ] {
                if let Some(DefaultVal::Fn(f)) = default {
                    let what = if matches!(slot, Slot::Default { .. }) {
                        "default"
                    } else {
                        "onUpdate"
                    };
                    out.roots.push(Root {
                        closure: f.clone(),
                        slot,
                        name: format!("{}__{what}__{name}", c.table),
                    });
                }
            }
        }
    }

    // Relations
    if let Some(rel) = cfg_map.get("relations") {
        relations(rel, ev, &mut out, span_of(ev, config, "relations", config_span))?;
        out.register_name = Some("relations");
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
                if k != "input" && k != "handler" {
                    return Err(Diag::new(
                        ev.key_span(&a.config, k).unwrap_or(a.span),
                        format!("action() has no option `{k}`"),
                    ));
                }
            }
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
                    if b.primary_key || b.unique || b.references.is_some() || b.on_update.is_some() {
                        return Err(Diag::new(
                            fspan,
                            format!("input `{field}` can't use primaryKey, unique, references, or $onUpdate"),
                        ));
                    }
                    let mut tmp_roots = Vec::new();
                    let col = column(field, b, "", ev, &out, &mut tmp_roots)?;
                    if let Some(DefaultVal::Fn(f)) = &b.default {
                        out.roots.push(Root {
                            closure: f.clone(),
                            slot: Slot::ActionDefault {
                                action: name.clone(),
                                field: field.clone(),
                            },
                            name: format!("action__{name}__default__{field}"),
                        });
                    }
                    input.insert(field.clone(), col);
                }
            }
            let Some(Value::Closure(handler)) = cfg.get("handler") else {
                return Err(Diag::new(a.span, format!("action `{name}` needs a `handler` function")));
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

fn api_options(c: &CollectionVal, ev: &Evaluator<'_>) -> Result<Api> {
    let mut api = Api {
        list: true,
        get: true,
        create: true,
        update: true,
        delete: true,
    };
    let Some(opts) = &c.options else { return Ok(api) };
    let Value::Object(o) = opts else { unreachable!() };
    for (k, v) in o.borrow().iter() {
        let span = ev.key_span(opts, k).unwrap_or(c.span);
        if k != "api" {
            return Err(Diag::new(span, format!("collection() has no option `{k}`")));
        }
        let Value::Object(flags) = v else {
            return Err(Diag::new(span, "`api` must be an object like `{ delete: false }`"));
        };
        for (fk, fv) in flags.borrow().iter() {
            let Value::Bool(b) = fv else {
                return Err(Diag::new(span, format!("`api.{fk}` must be true or false")));
            };
            match fk.as_str() {
                "list" => api.list = *b,
                "get" => api.get = *b,
                "create" => api.create = *b,
                "update" => api.update = *b,
                "delete" => api.delete = *b,
                other => {
                    return Err(Diag::new(span, format!("`api` has no flag `{other}`"))
                        .help("use list, get, create, update, delete"));
                }
            }
        }
    }
    Ok(api)
}

fn column(
    name: &str,
    b: &ColBuilder,
    table: &str,
    ev: &mut Evaluator<'_>,
    out: &Extracted,
    _roots: &mut Vec<Root>,
) -> Result<Column> {
    let default = match &b.default {
        None => None,
        Some(DefaultVal::Now) => Some(DefaultKind::Now),
        Some(DefaultVal::Fn(_)) => Some(DefaultKind::Fn(String::new())),
        Some(DefaultVal::Value(v)) => Some(DefaultKind::Value(check_value(name, b, v)?)),
    };
    let on_update = match &b.on_update {
        None => None,
        Some(DefaultVal::Now) => Some(DefaultKind::Now),
        Some(DefaultVal::Fn(_)) => Some(DefaultKind::Fn(String::new())),
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
    let _ = table;
    Ok(Column {
        name: name.to_string(),
        ty: b.ty,
        not_null: b.not_null,
        primary_key: b.primary_key,
        auto_increment: b.auto_increment,
        unique: b.unique,
        enum_values: b.enum_values.clone(),
        default,
        on_update,
        references,
        ts_type: b.ts_type.clone(),
    })
}

/// Validates a constant default against its column and returns it as JSON.
fn check_value(name: &str, b: &ColBuilder, v: &Value) -> Result<Json> {
    let bad = |what: &str| {
        Err(Diag::new(
            b.span,
            format!("`{name}` defaults to {}, but it's {what}", v.describe()),
        ))
    };
    if matches!(v, Value::Null | Value::Undef) {
        if b.not_null {
            return bad("notNull()");
        }
        return Ok(Json::Null);
    }
    match (b.ty, v) {
        (ColType::Integer, Value::Num(n)) if n.fract() == 0.0 && n.is_finite() => {}
        (ColType::Integer, _) => return bad("an integer column"),
        (ColType::Real, Value::Num(n)) if n.is_finite() => {}
        (ColType::Real, _) => return bad("a real column"),
        (ColType::Boolean, Value::Bool(_)) => {}
        (ColType::Boolean, _) => return bad("a boolean column"),
        (ColType::Text, Value::Str(s)) => {
            if let Some(values) = &b.enum_values
                && !values.iter().any(|x| x.as_str() == &**s)
            {
                return Err(Diag::new(
                    b.span,
                    format!("`{name}` defaults to \"{s}\", which isn't one of {}", values.join(", ")),
                ));
            }
        }
        (ColType::Text, _) => return bad("a text column"),
        (ColType::Date, Value::Str(s)) if is_date(s) => {}
        (ColType::Date, _) => return bad("a date column (use \"YYYY-MM-DD\" or .defaultNow())"),
        (ColType::Timestamp, Value::Str(_)) => {}
        (ColType::Timestamp, _) => return bad("a timestamp column (use an ISO string or .defaultNow())"),
        (ColType::Json, _) => {}
    }
    to_json(v).ok_or_else(|| {
        Diag::new(
            b.span,
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
                                optional: true,
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
                    optional: true,
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
