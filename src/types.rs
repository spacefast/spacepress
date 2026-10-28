//! Types the PHP compiler tracks. They decide which PHP to emit: native
//! operators when the types make it safe, `Js::` helpers where JavaScript and
//! PHP genuinely differ, and a build error where neither is sound.

use crate::schema::{ColType, Collection, Column, RelKind, Schema};
use indexmap::IndexMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Ty {
    Num,
    Str,
    Bool,
    /// `null` and `undefined` (both PHP null).
    Null,
    /// Values whose shape isn't known (untyped `json()` columns, `JSON.parse`).
    Unknown,
    Never,
    Array(Box<Ty>),
    Tuple(Vec<Ty>),
    /// Object with known fields: (type, optional).
    Obj(IndexMap<String, (Ty, bool)>),
    /// `Record<string, T>`
    Map(Box<Ty>),
    Union(Vec<Ty>),
    Fn(Vec<Ty>, Box<Ty>),
    Promise(Box<Ty>),
    /// Epoch milliseconds (a PHP number) that remembers it came from `Date`.
    Date,
    Regex,
    /// A caught exception.
    Error,
    // Zero runtime values
    Collection(String),
    Db,
    DbQuery,
    QueryColl(String),
    Builder(Box<Builder>),
}

#[derive(Debug, Clone, PartialEq)]
pub enum BuilderKind {
    Insert,
    Update,
    Delete,
}

/// `db.insert(t).values(v).returning()` and friends, assembled into one runtime call when awaited.
#[derive(Debug, Clone, PartialEq)]
pub struct Builder {
    pub kind: BuilderKind,
    pub table: String,
    pub values: Option<String>,
    pub set: Option<String>,
    pub filter: Option<String>,
    pub returning: bool,
}

impl Builder {
    pub fn php(&self) -> String {
        let t = crate::compile::php_str(&self.table);
        let r = if self.returning { ", true" } else { "" };
        match self.kind {
            BuilderKind::Insert => format!(
                "\\Zero\\db()->insert({t}, {}{r})",
                self.values.as_deref().unwrap_or("[]")
            ),
            BuilderKind::Update => format!(
                "\\Zero\\db()->update({t}, {}, {}{r})",
                self.set.as_deref().unwrap_or("[]"),
                self.filter.as_deref().unwrap_or("[]")
            ),
            BuilderKind::Delete => format!(
                "\\Zero\\db()->delete({t}, {}{r})",
                self.filter.as_deref().unwrap_or("[]")
            ),
        }
    }

    pub fn result(&self, schema: &Schema) -> Ty {
        if self.returning {
            Ty::Array(Box::new(row(schema, &self.table)))
        } else {
            Ty::Null
        }
    }
}

impl Ty {
    pub fn union(items: impl IntoIterator<Item = Ty>) -> Ty {
        let mut out: Vec<Ty> = Vec::new();
        for t in items {
            let parts = match t {
                Ty::Union(inner) => inner,
                Ty::Never => continue,
                other => vec![other],
            };
            for p in parts {
                // Merge `T[]` with `never[]` (from `[]` literals).
                if let Ty::Array(el) = &p
                    && let Some(existing) = out.iter_mut().find(|x| matches!(x, Ty::Array(_)))
                {
                    let Ty::Array(cur) = existing else { unreachable!() };
                    if **cur == Ty::Never {
                        *existing = Ty::Array(el.clone());
                        continue;
                    }
                    if **el == Ty::Never || cur == el {
                        continue;
                    }
                }
                if !out.contains(&p) {
                    out.push(p);
                }
            }
        }
        match out.len() {
            0 => Ty::Never,
            1 => out.pop().expect("one"),
            _ => Ty::Union(out),
        }
    }

    pub fn nullable(self) -> Ty {
        Ty::union([self, Ty::Null])
    }

    pub fn non_null(&self) -> Ty {
        match self {
            Ty::Union(items) => Ty::union(items.iter().filter(|t| **t != Ty::Null).cloned()),
            Ty::Null => Ty::Never,
            other => other.clone(),
        }
    }

    pub fn is_nullable(&self) -> bool {
        match self {
            Ty::Null | Ty::Unknown => true,
            Ty::Union(items) => items.contains(&Ty::Null),
            _ => false,
        }
    }

    /// True when every member satisfies `pred`.
    pub fn all(&self, pred: impl Fn(&Ty) -> bool) -> bool {
        match self {
            Ty::Union(items) => items.iter().all(pred),
            other => pred(other),
        }
    }

    pub fn is_num(&self) -> bool {
        self.all(|t| matches!(t, Ty::Num | Ty::Date))
    }

    pub fn is_str(&self) -> bool {
        *self == Ty::Str
    }

    pub fn describe(&self) -> String {
        match self {
            Ty::Num => "number".into(),
            Ty::Str => "string".into(),
            Ty::Bool => "boolean".into(),
            Ty::Null => "null".into(),
            Ty::Unknown => "unknown".into(),
            Ty::Never => "never".into(),
            Ty::Array(t) => format!("{}[]", t.describe()),
            Ty::Tuple(ts) => format!("[{}]", ts.iter().map(Ty::describe).collect::<Vec<_>>().join(", ")),
            Ty::Obj(fields) => {
                let f: Vec<String> = fields
                    .iter()
                    .take(4)
                    .map(|(k, (t, o))| format!("{k}{}: {}", if *o { "?" } else { "" }, t.describe()))
                    .collect();
                format!("{{ {}{} }}", f.join("; "), if fields.len() > 4 { "; ..." } else { "" })
            }
            Ty::Map(t) => format!("Record<string, {}>", t.describe()),
            Ty::Union(ts) => ts.iter().map(Ty::describe).collect::<Vec<_>>().join(" | "),
            Ty::Fn(..) => "a function".into(),
            Ty::Promise(t) => format!("Promise<{}>", t.describe()),
            Ty::Date => "Date".into(),
            Ty::Regex => "RegExp".into(),
            Ty::Error => "Error".into(),
            Ty::Collection(t) => format!("collection \"{t}\""),
            Ty::Db => "db".into(),
            Ty::DbQuery => "db.query".into(),
            Ty::QueryColl(t) => format!("db.query for \"{t}\""),
            Ty::Builder(b) => format!("an unfinished db.{:?} for \"{}\"", b.kind, b.table).to_lowercase(),
        }
    }

    pub fn field(&self, name: &str) -> Option<(Ty, bool)> {
        match self {
            Ty::Obj(fields) => fields.get(name).cloned(),
            Ty::Map(t) => Some(((**t).clone(), false)),
            _ => None,
        }
    }
}

fn col_select(c: &Column, json_ty: impl Fn(&Column) -> Ty) -> Ty {
    let base = match c.ty {
        ColType::Integer | ColType::Real => Ty::Num,
        ColType::Text | ColType::Timestamp | ColType::Date => Ty::Str,
        ColType::Boolean => Ty::Bool,
        ColType::Json => json_ty(c),
    };
    if c.not_null { base } else { base.nullable() }
}

thread_local! {
    /// Resolved `json().$type<T>()` types, keyed by "table.column" (filled by the compiler).
    pub static JSON_TYPES: std::cell::RefCell<std::collections::HashMap<String, Ty>> = Default::default();
}

fn json_ty(table: &str) -> impl Fn(&Column) -> Ty + '_ {
    move |c: &Column| {
        JSON_TYPES.with(|m| {
            m.borrow()
                .get(&format!("{table}.{}", c.name))
                .cloned()
                .unwrap_or(Ty::Unknown)
        })
    }
}

pub fn row_of(c: &Collection) -> Ty {
    Ty::Obj(
        c.columns
            .values()
            .map(|col| (col.name.clone(), (col_select(col, json_ty(&c.table)), false)))
            .collect(),
    )
}

pub fn row(schema: &Schema, table: &str) -> Ty {
    row_of(&schema.collections[table])
}

pub fn insert(schema: &Schema, table: &str) -> Ty {
    let c = &schema.collections[table];
    Ty::Obj(
        c.columns
            .values()
            .map(|col| {
                (
                    col.name.clone(),
                    (col_select(col, json_ty(table)), col.optional_on_insert()),
                )
            })
            .collect(),
    )
}

pub fn partial(t: Ty) -> Ty {
    match t {
        Ty::Obj(fields) => Ty::Obj(fields.into_iter().map(|(k, (t, _))| (k, (t, true))).collect()),
        other => other,
    }
}

/// Action input as the handler sees it, after defaults and validation.
pub fn action_input(columns: &IndexMap<String, Column>) -> Ty {
    Ty::Obj(
        columns
            .values()
            .map(|c| {
                let base = col_select(c, |_| Ty::Unknown);
                let required = c.not_null || c.default.is_some();
                let t = if c.not_null || c.default.is_some() {
                    base.non_null()
                } else {
                    base
                };
                let t = if required { t } else { t.nullable() };
                (c.name.clone(), (t, false))
            })
            .collect(),
    )
}

/// A row with relations loaded by `with`.
pub fn with_relations(schema: &Schema, table: &str, base: Ty, rel: &str, nested: Ty) -> Ty {
    let Ty::Obj(mut fields) = base else { return base };
    let r = &schema.collections[table].relations[rel];
    let t = match r.kind {
        RelKind::One if r.optional => nested.nullable(),
        RelKind::One => nested,
        RelKind::Many => Ty::Array(Box::new(nested)),
    };
    fields.insert(rel.to_string(), (t, false));
    Ty::Obj(fields)
}
