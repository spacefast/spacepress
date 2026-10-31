//! Schema snapshots and migration planning for both dialects.
//!
//! Each build compares the evaluated schema with the last snapshot
//! (`zero/migrations/snapshot.json`, committed with the project, shared by
//! both dialects) and writes the next numbered migration into
//! `zero/migrations/sqlite/` and `zero/migrations/wp/`.
//!
//! SQLite holds every collection. Additive changes use `ALTER TABLE ADD
//! COLUMN`; anything else rebuilds the table (create, copy, drop, rename),
//! which is the only way SQLite can change constraints. The runtime turns
//! foreign keys off around each migration file so rebuilds don't fire
//! cascades. The `__zero_*` system tables are created by the runtime.
//!
//! MySQL (WordPress) holds only `editor: false` collections, as
//! `{prefix}zero_<table>`, plus the `{prefix}zero__revisions` system table.
//! Post-backed collections live in `wp_posts`/`wp_postmeta` and get no table.
//! Changes are `ALTER TABLE` (add/modify/drop), never rebuilds. Foreign keys
//! exist only when both sides are custom tables (§4.2). `{prefix}` is the
//! WordPress table prefix, substituted by `Wp\Migrator`.

use crate::schema::{Collection, Column, DefaultKind, Schema};
use serde_json::{Value as Json, json};

pub const BREAKPOINT: &str = "--> statement-breakpoint";
/// Snapshot key of the WordPress revisions table (MySQL only).
const REVISIONS: &str = "zero__revisions";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    Sqlite,
    Mysql,
}

impl Dialect {
    pub fn dir(self) -> &'static str {
        match self {
            Dialect::Sqlite => "sqlite",
            Dialect::Mysql => "wp",
        }
    }

    fn q(self, ident: &str) -> String {
        match self {
            Dialect::Sqlite => format!("\"{}\"", ident.replace('"', "\"\"")),
            Dialect::Mysql => format!("`{}`", ident.replace('`', "``")),
        }
    }

    fn table(self, t: &str) -> String {
        match self {
            Dialect::Sqlite => self.q(t),
            Dialect::Mysql if t == REVISIONS => format!("`{{prefix}}{t}`"),
            Dialect::Mysql => format!("`{{prefix}}zero_{t}`"),
        }
    }

    fn string(self, s: &str) -> String {
        match self {
            Dialect::Sqlite => format!("'{}'", s.replace('\'', "''")),
            Dialect::Mysql => format!("'{}'", s.replace('\\', "\\\\").replace('\'', "''")),
        }
    }
}

/// The persisted shape of the schema: only what affects SQL.
pub fn snapshot(schema: &Schema) -> Json {
    let mut tables = serde_json::Map::new();
    for c in schema.collections.values() {
        tables.insert(c.table.clone(), table_snapshot(c, schema));
    }
    json!({ "version": 2, "tables": tables })
}

fn table_snapshot(c: &Collection, schema: &Schema) -> Json {
    let mut cols = serde_json::Map::new();
    // Derived columns (a localized collection's `translations`) are computed on read, never stored.
    for col in c
        .columns
        .values()
        .filter(|col| !(col.derived || col.system && col.name == "translationGroup"))
    {
        cols.insert(col.name.clone(), column_snapshot(col, schema));
    }
    let mut t = json!({ "editor": c.editor, "drafts": c.drafts, "columns": cols });
    if c.localized {
        // §7.3: the SQLite table (and a MySQL `editor: false` table) links a translation group with
        // this column. The snapshot is shared by both targets' builds, so it never depends on which
        // target extracted the schema (post-backed WP groups live in Polylang, not in this column).
        let mut group = crate::schema::Column::new("translationGroup", crate::schema::ColType::Text);
        group.system = true;
        let mut snap = column_snapshot(&group, schema);
        snap["max"] = json!(36); // a UUID; MySQL needs a bounded VARCHAR for the unique pair
        cols_insert(&mut t, "translationGroup", snap);
        t["localized"] = json!(true);
    }
    t
}

fn column_snapshot(col: &Column, schema: &Schema) -> Json {
    let references = col.references.as_ref().map(|r| {
        let target = &schema.collections[&r.collection];
        let unsigned = target.columns.get(&r.column).is_some_and(|t| t.auto_increment);
        json!({
            "table": r.collection,
            "column": r.column,
            "onDelete": r.on_delete.map(|a| a.sql()),
            "onUpdate": r.on_update.map(|a| a.sql()),
            "unsigned": unsigned,
        })
    });
    json!({
        "type": col.ty.name(),
        "notNull": col.not_null,
        "primaryKey": col.primary_key,
        "autoIncrement": col.auto_increment,
        "unique": col.unique,
        "max": col.rules.max.filter(|_| col.ty.is_stringy()),
        "enum": col.enum_values.as_ref().filter(|_| col.ty == crate::schema::ColType::Text),
        "default": sql_default(col),
        "references": references,
    })
}

/// Constant defaults are mirrored in SQL so rows written outside the runtime (and
/// ADD COLUMN on existing rows) get them too. Stored as JSON, rendered per dialect.
fn sql_default(col: &Column) -> Json {
    match &col.default {
        Some(DefaultKind::Value(v)) if !v.is_null() => v.clone(),
        _ => Json::Null,
    }
}

fn cols_insert(table: &mut Json, name: &str, col: Json) {
    if let Some(cols) = table["columns"].as_object_mut() {
        cols.insert(name.into(), col);
    }
}

/// A v1 snapshot (SQLite only, `sqlDefault` as SQL text) as v2. Its tables had no MySQL counterpart.
pub fn upgrade_v1_snapshot(v1: &Json) -> Json {
    let mut tables = serde_json::Map::new();
    if let Some(ts) = v1["tables"].as_object() {
        for (t, def) in ts {
            let mut cols = serde_json::Map::new();
            for (name, c) in def["columns"].as_object().into_iter().flatten() {
                let ty = c["type"].as_str().unwrap_or("text");
                let default = match c["sqlDefault"].as_str() {
                    None => Json::Null,
                    Some(s) if s.starts_with('\'') => {
                        let text = s[1..s.len().saturating_sub(1)].replace("''", "'");
                        if ty == "json" {
                            serde_json::from_str(&text).unwrap_or(Json::String(text))
                        } else {
                            Json::String(text)
                        }
                    }
                    Some(s) if ty == "boolean" => Json::Bool(s == "1"),
                    Some(s) => serde_json::from_str(s).unwrap_or(Json::Null),
                };
                let mut col = json!({
                    "type": ty,
                    "notNull": c["notNull"],
                    "primaryKey": c["primaryKey"],
                    "autoIncrement": c["autoIncrement"],
                    "unique": c["unique"],
                    "max": null,
                    "default": default,
                    "references": c["references"],
                });
                if let Some(r) = col["references"].as_object_mut() {
                    r.insert("unsigned".into(), Json::Bool(true));
                }
                cols.insert(name.clone(), col);
            }
            // `editor: true` = no MySQL table yet; the WP lane creates what's needed on the next build.
            tables.insert(t.clone(), json!({ "editor": true, "drafts": false, "columns": cols }));
        }
    }
    json!({ "version": 2, "tables": tables })
}

type Map = serde_json::Map<String, Json>;

/// The tables a dialect holds, from a snapshot.
fn dialect_tables(snap: &Json, d: Dialect) -> Map {
    let mut out = Map::new();
    let empty = Map::new();
    let tables = snap["tables"].as_object().unwrap_or(&empty);
    for (t, def) in tables {
        if d == Dialect::Mysql && def["editor"].as_bool() != Some(false) {
            continue;
        }
        out.insert(t.clone(), def.clone());
    }
    if d == Dialect::Mysql && !tables.is_empty() {
        let mut cols = Map::new();
        let c = |ty: &str, not_null: bool| json!({ "type": ty, "notNull": not_null, "primaryKey": false, "autoIncrement": false, "unique": false, "max": null, "default": null, "references": null });
        cols.insert(
            "id".into(),
            json!({ "type": "integer", "notNull": true, "primaryKey": true, "autoIncrement": true, "unique": false, "max": null, "default": null, "references": null }),
        );
        let mut collection = c("text", true);
        collection["max"] = json!(64);
        cols.insert("collection".into(), collection);
        let mut pk = c("text", true);
        pk["max"] = json!(64);
        cols.insert("pk".into(), pk);
        cols.insert("at".into(), c("timestamp", true));
        cols.insert("userId".into(), c("integer", false));
        cols.insert("row".into(), c("json", true));
        out.insert(
            REVISIONS.into(),
            json!({ "editor": false, "drafts": false, "system": true, "columns": cols }),
        );
    }
    out
}

/// A custom table's column as DDL. `None` for MySQL foreign keys (rendered as constraints).
fn column_sql(d: Dialect, name: &str, c: &Json, tables: &Map) -> String {
    let ty = c["type"].as_str().unwrap_or("text");
    let max = c["max"].as_f64();
    let unique = c["unique"].as_bool() == Some(true);
    let pk = c["primaryKey"].as_bool() == Some(true);
    let auto = c["autoIncrement"].as_bool() == Some(true);
    let not_null = c["notNull"].as_bool() == Some(true) || pk;
    let unsigned_ref = c["references"]["unsigned"].as_bool() == Some(true);
    let sql_ty = match d {
        Dialect::Sqlite => match ty {
            "integer" | "boolean" | "media" | "file" => "integer".to_string(),
            "real" => "real".to_string(),
            _ => "text".to_string(),
        },
        Dialect::Mysql => match ty {
            "integer" | "media" | "file" if (pk && auto) || unsigned_ref => "BIGINT UNSIGNED".into(),
            "integer" | "media" | "file" => "BIGINT".into(),
            "real" => "DOUBLE".into(),
            "boolean" => "TINYINT(1)".into(),
            "timestamp" => "CHAR(24)".into(),
            "date" => "CHAR(10)".into(),
            "slug" => format!("VARCHAR({})", max.map_or(200, |m| m.min(200.0) as u32)),
            "text" | "email" | "url" if unique || max.is_some_and(|m| m <= 191.0) => {
                format!("VARCHAR({})", max.map_or(191, |m| m as u32))
            }
            "text" if c["enum"].is_array() => "VARCHAR(191)".into(),
            _ => "LONGTEXT".into(),
        },
    };
    let mut sql = format!("{} {sql_ty}", d.q(name));
    if pk {
        sql.push_str(match d {
            Dialect::Sqlite if auto => " PRIMARY KEY AUTOINCREMENT",
            Dialect::Sqlite => " PRIMARY KEY",
            Dialect::Mysql if auto => " NOT NULL AUTO_INCREMENT",
            Dialect::Mysql => " NOT NULL",
        });
    }
    if !c["default"].is_null() {
        let v = &c["default"];
        let lit = match (ty, v) {
            ("boolean", Json::Bool(b)) => (if *b { "1" } else { "0" }).to_string(),
            (_, Json::Number(n)) => n.to_string(),
            (_, Json::String(s)) => d.string(s),
            (_, v) => d.string(&v.to_string()),
        };
        // MySQL only accepts literal defaults on TEXT columns as expressions.
        let long = d == Dialect::Mysql && sql_ty == "LONGTEXT";
        sql.push_str(&if long {
            format!(" DEFAULT ({lit})")
        } else {
            format!(" DEFAULT {lit}")
        });
    }
    if not_null && !(pk && d == Dialect::Mysql) {
        sql.push_str(" NOT NULL");
    }
    if d == Dialect::Sqlite
        && let Some(r) = c["references"].as_object()
    {
        sql.push_str(&format!(
            " REFERENCES {}({})",
            d.q(r["table"].as_str().unwrap_or_default()),
            d.q(r["column"].as_str().unwrap_or_default())
        ));
        if let Some(a) = r["onDelete"].as_str() {
            sql.push_str(&format!(" ON DELETE {a}"));
        }
        if let Some(a) = r["onUpdate"].as_str() {
            sql.push_str(&format!(" ON UPDATE {a}"));
        }
    }
    let _ = tables;
    sql
}

/// MySQL foreign key constraint for a column, when both sides are custom tables.
fn fk_sql(t: &str, name: &str, c: &Json, tables: &Map) -> Option<String> {
    let r = c["references"].as_object()?;
    let target = r["table"].as_str()?;
    if !tables.contains_key(target) {
        return None; // post-backed target: the pipeline checks existence and emulates the action
    }
    let mut sql = format!(
        "CONSTRAINT `{}` FOREIGN KEY ({}) REFERENCES {} ({})",
        fk_name(t, name),
        Dialect::Mysql.q(name),
        Dialect::Mysql.table(target),
        Dialect::Mysql.q(r["column"].as_str().unwrap_or("id"))
    );
    if let Some(a) = r["onDelete"].as_str() {
        sql.push_str(&format!(" ON DELETE {}", a.to_uppercase()));
    }
    if let Some(a) = r["onUpdate"].as_str() {
        sql.push_str(&format!(" ON UPDATE {}", a.to_uppercase()));
    }
    Some(sql)
}

fn fk_name(t: &str, col: &str) -> String {
    // MySQL identifiers are limited to 64 characters.
    let n = format!("zero_{t}_{col}_fk");
    n.chars().take(64).collect()
}

/// (index name, unique, columns) for a table.
fn indexes(t: &str, def: &Json, d: Dialect) -> Vec<(String, bool, Vec<String>)> {
    let mut out = Vec::new();
    let empty = Map::new();
    let cols = def["columns"].as_object().unwrap_or(&empty);
    let prefix = match d {
        Dialect::Sqlite => format!("{t}_"),
        Dialect::Mysql => String::new(),
    };
    for (name, c) in cols {
        if c["unique"].as_bool() == Some(true) && c["primaryKey"].as_bool() != Some(true) {
            out.push((format!("{prefix}{name}_unique"), true, vec![name.clone()]));
        }
    }
    if def["drafts"].as_bool() == Some(true) && cols.contains_key("status") && cols.contains_key("publishedAt") {
        out.push((
            format!("{prefix}status_publishedAt"),
            false,
            vec!["status".into(), "publishedAt".into()],
        ));
    }
    // §7.3: one row per locale in a translation group.
    if def["localized"].as_bool() == Some(true) && cols.contains_key("translationGroup") && cols.contains_key("locale")
    {
        out.push((
            format!("{prefix}translationGroup_locale"),
            true,
            vec!["translationGroup".into(), "locale".into()],
        ));
    }
    if def["system"].as_bool() == Some(true) && t == REVISIONS {
        out.push(("row".into(), false, vec!["collection".into(), "pk".into()]));
    }
    out
}

fn create_index(d: Dialect, t: &str, (name, unique, cols): &(String, bool, Vec<String>)) -> String {
    let cols: Vec<String> = cols.iter().map(|c| d.q(c)).collect();
    let u = if *unique { "UNIQUE " } else { "" };
    match d {
        Dialect::Sqlite => format!("CREATE {u}INDEX {} ON {} ({});", d.q(name), d.table(t), cols.join(", ")),
        Dialect::Mysql => format!(
            "ALTER TABLE {} ADD {u}{} {} ({});",
            d.table(t),
            if *unique { "KEY" } else { "INDEX" },
            d.q(name),
            cols.join(", ")
        ),
    }
}

fn drop_index(d: Dialect, t: &str, name: &str) -> String {
    match d {
        Dialect::Sqlite => format!("DROP INDEX IF EXISTS {};", d.q(name)),
        Dialect::Mysql => format!("ALTER TABLE {} DROP INDEX {};", d.table(t), d.q(name)),
    }
}

fn create_table(d: Dialect, t: &str, def: &Json, tables: &Map, as_name: Option<&str>) -> Vec<String> {
    let empty = Map::new();
    let cols = def["columns"].as_object().unwrap_or(&empty);
    let mut body: Vec<String> = cols.iter().map(|(n, c)| column_sql(d, n, c, tables)).collect();
    let mut out = Vec::new();
    match d {
        Dialect::Sqlite => {
            let name = as_name.map(|n| d.q(n)).unwrap_or_else(|| d.table(t));
            out.push(format!("CREATE TABLE {name} (\n\t{}\n);", body.join(",\n\t")));
            if as_name.is_none() {
                for ix in indexes(t, def, d) {
                    out.push(create_index(d, t, &ix));
                }
            }
        }
        Dialect::Mysql => {
            if let Some((pk, _)) = cols.iter().find(|(_, c)| c["primaryKey"].as_bool() == Some(true)) {
                body.push(format!("PRIMARY KEY ({})", d.q(pk)));
            }
            for (name, unique, ix_cols) in indexes(t, def, d) {
                let cols: Vec<String> = ix_cols.iter().map(|c| d.q(c)).collect();
                body.push(format!(
                    "{}KEY {} ({})",
                    if unique { "UNIQUE " } else { "" },
                    d.q(&name),
                    cols.join(", ")
                ));
            }
            for (n, c) in cols {
                if let Some(fk) = fk_sql(t, n, c, tables) {
                    body.push(fk);
                }
            }
            out.push(format!(
                "CREATE TABLE {} (\n\t{}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
                d.table(t),
                body.join(",\n\t")
            ));
        }
    }
    out
}

/// Statements that turn `prev` into `next` for one dialect. Empty when nothing changed.
pub fn plan(prev: &Json, next: &Json, d: Dialect) -> Vec<String> {
    let prev_t = dialect_tables(prev, d);
    let next_t = dialect_tables(next, d);
    let empty = Map::new();
    let mut out = Vec::new();
    // New tables, in dependency order (referenced tables first).
    let mut created: Vec<&String> = Vec::new();
    let mut pending: Vec<&String> = next_t.keys().filter(|t| !prev_t.contains_key(*t)).collect();
    while !pending.is_empty() {
        let before = pending.len();
        pending.retain(|t| {
            let deps_ready = next_t[*t]["columns"].as_object().unwrap_or(&empty).values().all(|c| {
                c["references"]["table"].as_str().is_none_or(|dep| {
                    dep == t.as_str()
                        || !next_t.contains_key(dep)
                        || prev_t.contains_key(dep)
                        || created.iter().any(|x| x.as_str() == dep)
                })
            });
            if deps_ready {
                created.push(t);
            }
            !deps_ready
        });
        if pending.len() == before {
            // Reference cycle: SQLite accepts forward references, so emit the rest as-is.
            created.append(&mut pending);
        }
    }
    for t in created {
        out.extend(create_table(d, t, &next_t[t], &next_t, None));
    }
    for (t, next_def) in &next_t {
        let Some(prev_def) = prev_t.get(t) else { continue };
        let pc = prev_def["columns"].as_object().unwrap_or(&empty);
        let nc = next_def["columns"].as_object().unwrap_or(&empty);
        let render = |m: &Map, tables: &Map| -> Vec<(String, String)> {
            m.iter()
                .map(|(k, c)| (k.clone(), column_sql(d, k, c, tables)))
                .collect()
        };
        let pr = render(pc, &prev_t);
        let nr = render(nc, &next_t);
        let p_ix = indexes(t, prev_def, d);
        let n_ix = indexes(t, next_def, d);
        match d {
            Dialect::Sqlite => {
                if pr != nr {
                    let only_additions = pr.iter().all(|(k, v)| nr.iter().any(|(nk, nv)| nk == k && nv == v));
                    let added: Vec<&(String, String)> = nr.iter().filter(|(k, _)| !pc.contains_key(k)).collect();
                    let addable = added.iter().all(|(k, _)| {
                        let c = &nc[k];
                        // SQLite ADD COLUMN can't add a PRIMARY KEY, or NOT NULL without a default.
                        c["primaryKey"].as_bool() != Some(true)
                            && (c["notNull"].as_bool() != Some(true) || !c["default"].is_null())
                    });
                    if only_additions && addable {
                        for (_, sql) in added {
                            out.push(format!("ALTER TABLE {} ADD COLUMN {sql};", d.table(t)));
                        }
                    } else {
                        // Rebuild: copy the columns both versions share, then restore the indexes.
                        let tmp = format!("__new_{t}");
                        out.extend(create_table(d, t, next_def, &next_t, Some(&tmp)));
                        let shared: Vec<String> = nc.keys().filter(|k| pc.contains_key(*k)).map(|k| d.q(k)).collect();
                        if !shared.is_empty() {
                            out.push(format!(
                                "INSERT INTO {} ({cols}) SELECT {cols} FROM {};",
                                d.q(&tmp),
                                d.table(t),
                                cols = shared.join(", ")
                            ));
                        }
                        out.push(format!("DROP TABLE {};", d.table(t)));
                        out.push(format!("ALTER TABLE {} RENAME TO {};", d.q(&tmp), d.table(t)));
                        for ix in &n_ix {
                            out.push(create_index(d, t, ix));
                        }
                        continue;
                    }
                }
                for ix in &p_ix {
                    if !n_ix.contains(ix) {
                        out.push(drop_index(d, t, &ix.0));
                    }
                }
                for ix in &n_ix {
                    if !p_ix.contains(ix) {
                        out.push(create_index(d, t, ix));
                    }
                }
            }
            Dialect::Mysql => {
                let table = d.table(t);
                // Constraints that go away (or change) are dropped before columns change.
                for (k, c) in pc {
                    let before = fk_sql(t, k, c, &prev_t);
                    let after = nc.get(k).and_then(|nc| fk_sql(t, k, nc, &next_t));
                    if before.is_some() && before != after {
                        out.push(format!("ALTER TABLE {table} DROP FOREIGN KEY `{}`;", fk_name(t, k)));
                    }
                }
                for ix in &p_ix {
                    if !n_ix.contains(ix) {
                        out.push(drop_index(d, t, &ix.0));
                    }
                }
                for (k, sql) in &nr {
                    match pr.iter().find(|(pk, _)| pk == k) {
                        None => out.push(format!("ALTER TABLE {table} ADD COLUMN {sql};")),
                        Some((_, psql)) if psql != sql => out.push(format!("ALTER TABLE {table} MODIFY COLUMN {sql};")),
                        _ => {}
                    }
                }
                for (k, _) in &pr {
                    if !nc.contains_key(k) {
                        out.push(format!("ALTER TABLE {table} DROP COLUMN {};", d.q(k)));
                    }
                }
                for ix in &n_ix {
                    if !p_ix.contains(ix) {
                        out.push(create_index(d, t, ix));
                    }
                }
                for (k, c) in nc {
                    let before = pc.get(k).and_then(|pc| fk_sql(t, k, pc, &prev_t));
                    if let Some(after) = fk_sql(t, k, c, &next_t)
                        && before.as_ref() != Some(&after)
                    {
                        out.push(format!("ALTER TABLE {table} ADD {after};"));
                    }
                }
            }
        }
    }
    for t in prev_t.keys().filter(|t| !next_t.contains_key(*t)) {
        out.push(format!("DROP TABLE {};", d.table(t)));
    }
    out
}

/// Human-readable warnings for changes that can lose data.
pub fn destructive(prev: &Json, next: &Json) -> Vec<String> {
    let empty = Map::new();
    let prev_t = prev["tables"].as_object().unwrap_or(&empty);
    let next_t = next["tables"].as_object().unwrap_or(&empty);
    let mut out = Vec::new();
    for (t, def) in prev_t {
        match next_t.get(t) {
            None => out.push(format!("drops table \"{t}\" and all its rows")),
            Some(n) => {
                for k in def["columns"].as_object().unwrap_or(&empty).keys() {
                    if !n["columns"].as_object().unwrap_or(&empty).contains_key(k) {
                        out.push(format!("drops column \"{t}\".\"{k}\""));
                    }
                }
                if def["editor"].as_bool() == Some(false) && n["editor"].as_bool() != Some(false) {
                    out.push(format!(
                        "drops the WordPress table for \"{t}\" (it becomes post-backed; existing rows aren't moved)"
                    ));
                }
            }
        }
    }
    out
}

pub fn render(statements: &[String]) -> String {
    let mut s = statements.join(&format!("\n{BREAKPOINT}\n"));
    s.push('\n');
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(tables: Json) -> Json {
        json!({ "version": 2, "tables": tables })
    }

    fn col(ty: &str) -> Json {
        json!({ "type": ty, "notNull": false, "primaryKey": false, "autoIncrement": false, "unique": false, "max": null, "default": null, "references": null })
    }

    #[test]
    fn creates_referenced_tables_first_then_adds_then_rebuilds() {
        let id = json!({ "type": "integer", "notNull": true, "primaryKey": true, "autoIncrement": true, "unique": false, "max": null, "default": null, "references": null });
        let mut fk = col("integer");
        fk["references"] =
            json!({ "table": "locations", "column": "id", "onDelete": "set null", "onUpdate": null, "unsigned": true });
        let table = |cols: Json| json!({ "editor": false, "drafts": false, "columns": cols });
        let v1 = snap(json!({
            "items": table(json!({ "id": id, "locationId": fk })),
            "locations": table(json!({ "id": id })),
        }));
        let first = plan(&snap(json!({})), &v1, Dialect::Sqlite);
        assert!(first[0].starts_with("CREATE TABLE \"locations\""), "{first:?}");
        assert!(
            first[1].contains("REFERENCES \"locations\"(\"id\") ON DELETE set null"),
            "{first:?}"
        );
        // The same snapshot on MySQL: prefixed tables, an unsigned FK column, a real constraint.
        let my = plan(&snap(json!({})), &v1, Dialect::Mysql);
        let items = my
            .iter()
            .find(|s| s.contains("`{prefix}zero_items`"))
            .expect("items table");
        assert!(items.contains("`locationId` BIGINT UNSIGNED"), "{items}");
        assert!(
            items.contains("FOREIGN KEY (`locationId`) REFERENCES `{prefix}zero_locations` (`id`) ON DELETE SET NULL"),
            "{items}"
        );

        // Adding a nullable column is an ALTER; making it NOT NULL is a rebuild (SQLite) or MODIFY (MySQL).
        let mut v2 = v1.clone();
        v2["tables"]["items"]["columns"]["note"] = col("text");
        assert_eq!(
            plan(&v1, &v2, Dialect::Sqlite),
            vec!["ALTER TABLE \"items\" ADD COLUMN \"note\" text;".to_string()]
        );

        let mut v3 = v2.clone();
        v3["tables"]["items"]["columns"]["note"]["notNull"] = json!(true);
        let rebuild = plan(&v2, &v3, Dialect::Sqlite);
        assert_eq!(rebuild.len(), 4, "{rebuild:?}");
        assert!(rebuild[1].starts_with("INSERT INTO \"__new_items\""));
        assert_eq!(rebuild[3], "ALTER TABLE \"__new_items\" RENAME TO \"items\";");
        assert_eq!(
            plan(&v2, &v3, Dialect::Mysql),
            vec!["ALTER TABLE `{prefix}zero_items` MODIFY COLUMN `note` LONGTEXT NOT NULL;".to_string()]
        );
        assert!(plan(&v3, &v3, Dialect::Sqlite).is_empty());
        assert!(plan(&v3, &v3, Dialect::Mysql).is_empty());
    }

    #[test]
    fn localizing_a_table_adds_locale_and_group_with_a_unique_pair() {
        let id = json!({ "type": "integer", "notNull": true, "primaryKey": true, "autoIncrement": true, "unique": false, "max": null, "default": null, "references": null });
        let v1 = snap(
            json!({ "pages": { "editor": false, "drafts": false, "columns": { "id": id, "title": col("text") } } }),
        );
        let mut locale = col("text");
        locale["notNull"] = json!(true);
        locale["enum"] = json!(["en", "de"]);
        locale["default"] = json!("en");
        let mut v2 = v1.clone();
        v2["tables"]["pages"]["localized"] = json!(true);
        v2["tables"]["pages"]["columns"]["locale"] = locale;
        let mut group = col("text");
        group["max"] = json!(36);
        v2["tables"]["pages"]["columns"]["translationGroup"] = group;
        assert_eq!(
            plan(&v1, &v2, Dialect::Sqlite),
            vec![
                "ALTER TABLE \"pages\" ADD COLUMN \"locale\" text DEFAULT 'en' NOT NULL;".to_string(),
                "ALTER TABLE \"pages\" ADD COLUMN \"translationGroup\" text;".to_string(),
                "CREATE UNIQUE INDEX \"pages_translationGroup_locale\" ON \"pages\" (\"translationGroup\", \"locale\");".to_string(),
            ]
        );
        assert_eq!(
            plan(&v1, &v2, Dialect::Mysql),
            vec![
                "ALTER TABLE `{prefix}zero_pages` ADD COLUMN `locale` VARCHAR(191) DEFAULT 'en' NOT NULL;".to_string(),
                "ALTER TABLE `{prefix}zero_pages` ADD COLUMN `translationGroup` VARCHAR(36);".to_string(),
                "ALTER TABLE `{prefix}zero_pages` ADD UNIQUE KEY `translationGroup_locale` (`translationGroup`, `locale`);".to_string(),
            ]
        );
    }
}
