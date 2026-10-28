//! Emits `zero/app/schema.php` (version 2, design §2: the runtime's whole view
//! of the app, WordPress identifiers included) and `zero.gen.ts` (registers the
//! schema with the `"zero"` types).

use crate::compile::{php_json, php_str};
use crate::num::php_number;
use crate::schema::{Access, Collection, Column, DefaultKind, RelKind, Schema};
use indexmap::IndexMap;
use std::fmt::Write as _;

/// Where a column appears: keys that only make sense at the top level are dropped elsewhere.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Ctx {
    Column,
    /// Sub-fields, global fields, action inputs.
    Nested,
}

fn generator(d: &DefaultKind) -> String {
    match d {
        DefaultKind::Value(v) => format!("['value' => {}]", php_json(v)),
        DefaultKind::Now => "['now' => true]".to_string(),
        DefaultKind::Fn(name) => format!("['fn' => {}]", php_str(name)),
    }
}

fn num(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15 {
        format!("{}", n as i64)
    } else {
        php_number(n)
    }
}

fn column(c: &Column, ctx: Ctx, indent: usize) -> String {
    let top = ctx == Ctx::Column;
    let mut parts = vec![format!("'type' => {}", php_str(c.ty.name()))];
    if c.primary_key && top {
        parts.push("'primaryKey' => true".into());
    }
    if c.auto_increment && top {
        parts.push("'autoIncrement' => true".into());
    }
    let enum_php = c.enum_values.as_ref().map(|e| {
        format!(
            "'enum' => [{}]",
            e.iter().map(|v| php_str(v)).collect::<Vec<_>>().join(", ")
        )
    });
    // Kind options come right after the type (the order §2's example uses).
    let multiple = c.ty == crate::schema::ColType::Select;
    if multiple {
        parts.push("'multiple' => true".into());
        parts.extend(enum_php.clone());
    }
    if c.multiline {
        parts.push("'multiline' => true".into());
    }
    if let Some(a) = &c.accept {
        parts.push(format!("'accept' => {}", php_str(a)));
    }
    if c.not_null {
        parts.push("'notNull' => true".into());
    }
    if c.unique && top {
        parts.push("'unique' => true".into());
    }
    if !multiple {
        parts.extend(enum_php);
    }
    if let Some(s) = &c.source {
        parts.push(format!("'source' => {}", php_str(s)));
    }
    if let Some(d) = &c.default {
        parts.push(format!("'default' => {}", generator(d)));
    }
    if let Some(d) = &c.on_update
        && top
    {
        parts.push(format!("'onUpdate' => {}", generator(d)));
    }
    if let Some(r) = &c.references
        && top
    {
        let mut rp = vec![
            format!("'collection' => {}", php_str(&r.collection)),
            format!("'column' => {}", php_str(&r.column)),
        ];
        if let Some(a) = r.on_delete {
            rp.push(format!("'onDelete' => {}", php_str(a.sql())));
        }
        parts.push(format!("'references' => [{}]", rp.join(", ")));
    }
    if !c.rules.is_empty() {
        let mut rp = Vec::new();
        if let Some(n) = c.rules.min {
            rp.push(format!("'min' => {}", num(n)));
        }
        if let Some(n) = c.rules.max {
            rp.push(format!("'max' => {}", num(n)));
        }
        if let Some((source, flags)) = &c.rules.pattern {
            rp.push(format!(
                "'pattern' => ['source' => {}, 'flags' => {}]",
                php_str(source),
                php_str(flags)
            ));
        }
        if let Some(v) = &c.rules.validate {
            rp.push(format!("'validate' => {}", php_str(v)));
        }
        parts.push(format!("'rules' => [{}]", rp.join(", ")));
    }
    if let Some(fields) = &c.fields {
        parts.push(format!("'fields' => {}", fields_block(fields, indent + 1)));
    }
    if let Some(layouts) = &c.layouts {
        let pad = "    ".repeat(indent + 1);
        let mut s = String::from("[\n");
        for (name, fields) in layouts {
            let _ = writeln!(s, "{pad}    {} => {},", php_str(name), fields_block(fields, indent + 2));
        }
        let _ = write!(s, "{pad}]");
        parts.push(format!("'layouts' => {s}"));
    }
    if c.system && top {
        parts.push("'system' => true".into());
    }
    format!("[{}]", parts.join(", "))
}

fn fields_block(fields: &IndexMap<String, Column>, indent: usize) -> String {
    let pad = "    ".repeat(indent);
    let mut s = String::from("[\n");
    for f in fields.values() {
        let _ = writeln!(
            s,
            "{pad}    {} => {},",
            php_str(&f.name),
            column(f, Ctx::Nested, indent + 1)
        );
    }
    let _ = write!(s, "{pad}]");
    s
}

fn access(a: &Access) -> String {
    match a {
        Access::Allow(b) => format!("['allow' => {b}]"),
        Access::Role(r) => format!("['role' => {}]", php_str(r)),
        Access::Fn(f) => format!("['fn' => {}]", php_str(f)),
    }
}

fn opt(s: &Option<String>) -> String {
    s.as_deref().map(php_str).unwrap_or_else(|| "null".into())
}

fn collection(out: &mut String, c: &Collection) {
    let pk = c.primary_key().map(|p| p.name.as_str()).unwrap_or("id");
    let _ = writeln!(out, "        {} => [", php_str(&c.table));
    let _ = writeln!(out, "            'key' => {},", php_str(&c.key));
    let _ = writeln!(out, "            'label' => {},", php_str(&c.label));
    let _ = writeln!(out, "            'editor' => {},", c.editor);
    let _ = writeln!(out, "            'drafts' => {},", c.drafts);
    let _ = writeln!(out, "            'revisions' => {},", c.revisions);
    let _ = writeln!(out, "            'title' => {},", opt(&c.title));
    let _ = writeln!(out, "            'content' => {},", opt(&c.content));
    let _ = writeln!(out, "            'slug' => {},", opt(&c.slug));
    let _ = writeln!(out, "            'primaryKey' => {},", php_str(pk));
    let _ = writeln!(out, "            'columns' => [");
    for col in c.columns.values() {
        let _ = writeln!(
            out,
            "                {} => {},",
            php_str(&col.name),
            column(col, Ctx::Column, 4)
        );
    }
    let _ = writeln!(out, "            ],");
    let _ = writeln!(out, "            'relations' => [");
    for r in c.relations.values() {
        let kind = if r.kind == RelKind::One { "one" } else { "many" };
        let _ = writeln!(
            out,
            "                {} => ['kind' => '{kind}', 'collection' => {}, 'from' => {}, 'to' => {}, 'optional' => {}],",
            php_str(&r.name),
            php_str(&r.collection),
            php_str(&r.from),
            php_str(&r.to),
            r.optional
        );
    }
    let _ = writeln!(out, "            ],");
    let hooks: Vec<String> = c
        .hooks
        .iter()
        .map(|(k, f)| format!("{} => {}", php_str(k.name()), php_str(f)))
        .collect();
    let _ = writeln!(out, "            'hooks' => [{}],", hooks.join(", "));
    let fills: Vec<String> = c.before_create_fills.iter().map(|f| php_str(f)).collect();
    let _ = writeln!(out, "            'beforeCreateFills' => [{}],", fills.join(", "));
    let _ = writeln!(out, "            'access' => [");
    for (op, rule) in &c.access {
        let _ = writeln!(out, "                {} => {},", php_str(op), access(rule));
    }
    let _ = writeln!(out, "            ],");
    let _ = writeln!(
        out,
        "            'api' => ['list' => {}, 'get' => {}, 'create' => {}, 'update' => {}, 'delete' => {}],",
        c.api.list, c.api.get, c.api.create, c.api.update, c.api.delete
    );
    if c.editor {
        let t = &c.table;
        let _ = writeln!(
            out,
            "            'wp' => ['postType' => 'zero_{t}', 'groupKey' => 'group_zero_{t}', 'metaPrefix' => 'zero_', 'fieldKeyPrefix' => 'field_zero_{t}_'],"
        );
        let _ = writeln!(out, "            'table' => null,");
    } else {
        let _ = writeln!(out, "            'wp' => null,");
        let _ = writeln!(out, "            'table' => {},", php_str(&format!("zero_{}", c.table)));
    }
    let _ = writeln!(out, "        ],");
}

pub fn render(schema: &Schema) -> String {
    let mut out =
        String::from("<?php\n\n// Generated by `zero build`. Do not edit.\n\ndeclare(strict_types=1);\n\nreturn [\n");
    let _ = writeln!(out, "    'version' => 2,");
    let _ = writeln!(out, "    'name' => {},", php_str(&schema.name));
    let _ = writeln!(out, "    'target' => {},", php_str(schema.target.name()));
    out.push_str("    'collections' => [\n");
    for c in schema.collections.values() {
        collection(&mut out, c);
    }
    out.push_str("    ],\n    'globals' => [\n");
    for g in schema.globals.values() {
        let n = &g.name;
        let _ = writeln!(out, "        {} => [", php_str(n));
        let _ = writeln!(out, "            'label' => {},", php_str(&g.label));
        let _ = writeln!(out, "            'fields' => {},", fields_block(&g.fields, 3));
        let rules: Vec<String> = g
            .access
            .iter()
            .map(|(op, r)| format!("{} => {}", php_str(op), access(r)))
            .collect();
        let _ = writeln!(out, "            'access' => [{}],", rules.join(", "));
        let _ = writeln!(
            out,
            "            'wp' => ['postId' => 'zero_global_{n}', 'menuSlug' => 'zero-global-{n}', 'groupKey' => 'group_zero_global_{n}', 'fieldKeyPrefix' => 'field_zero_global_{n}_', 'optionPrefix' => 'zero_global_{n}_'],"
        );
        let _ = writeln!(out, "        ],");
    }
    out.push_str("    ],\n    'actions' => [\n");
    for a in schema.actions.values() {
        let _ = writeln!(out, "        {} => [", php_str(&a.name));
        let _ = writeln!(out, "            'input' => {},", fields_block(&a.input, 3));
        let _ = writeln!(out, "            'handler' => {},", php_str(&a.handler));
        let _ = writeln!(out, "            'access' => {},", access(&a.access));
        let _ = writeln!(out, "        ],");
    }
    out.push_str("    ],\n];\n");
    out
}

/// `zero.gen.ts`: one line that types `db` for this project.
pub fn gen_ts(register: &str, has_globals: bool) -> String {
    let mut out = format!(
        "// Generated by `zero build`. Do not edit.\n// Registers this project's schema so `db` (imported from \"zero\") is typed.\nimport type {{ {register} }} from \"./zero.config\";\n"
    );
    if has_globals {
        // `db.globals` is typed from the default export.
        out.push_str("import type config from \"./zero.config\";\n");
        out.push_str(&format!(
            "declare module \"zero\" {{ interface Register {{ {register}: typeof {register}; config: typeof config }} }}\n"
        ));
    } else {
        out.push_str(&format!(
            "declare module \"zero\" {{ interface Register {{ {register}: typeof {register} }} }}\n"
        ));
    }
    out
}
