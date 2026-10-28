//! Schema snapshots and SQLite migration planning.
//!
//! Each build compares the evaluated schema with the last snapshot
//! (`zero/snapshot.json`, committed with the project) and writes the next
//! numbered migration. Additive changes use `ALTER TABLE ADD COLUMN`;
//! anything else rebuilds the table (create, copy, drop, rename), which is
//! the only way SQLite can change constraints. The runtime turns foreign keys
//! off around each migration file so rebuilds don't fire cascades.

use crate::schema::{ColType, Column, DefaultKind, Schema};
use serde_json::{Value as Json, json};

pub const BREAKPOINT: &str = "--> statement-breakpoint";

/// The persisted shape of the schema: only what affects SQL.
pub fn snapshot(schema: &Schema) -> Json {
    let mut tables = serde_json::Map::new();
    for c in schema.collections.values() {
        let mut cols = serde_json::Map::new();
        for col in c.columns.values() {
            cols.insert(col.name.clone(), column_snapshot(col));
        }
        tables.insert(c.table.clone(), json!({ "columns": cols }));
    }
    json!({ "version": 1, "tables": tables })
}

fn column_snapshot(col: &Column) -> Json {
    json!({
        "type": col.ty.name(),
        "notNull": col.not_null,
        "primaryKey": col.primary_key,
        "autoIncrement": col.auto_increment,
        "unique": col.unique,
        "sqlDefault": sql_default(col),
        "references": col.references.as_ref().map(|r| json!({
            "table": r.collection,
            "column": r.column,
            "onDelete": r.on_delete.map(|a| a.sql()),
            "onUpdate": r.on_update.map(|a| a.sql()),
        })),
    })
}

/// SQL-level default. Constant defaults are mirrored in SQL so rows written
/// outside the runtime (and ADD COLUMN on existing rows) get them too.
fn sql_default(col: &Column) -> Option<String> {
    match &col.default {
        Some(DefaultKind::Value(v)) if !v.is_null() => Some(match (col.ty, v) {
            (ColType::Boolean, Json::Bool(b)) => (if *b { "1" } else { "0" }).to_string(),
            (ColType::Integer | ColType::Real, Json::Number(n)) => n.to_string(),
            (ColType::Json, v) => sql_string(&v.to_string()),
            (_, Json::String(s)) => sql_string(s),
            (_, v) => sql_string(&v.to_string()),
        }),
        _ => None,
    }
}

fn sql_string(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn q(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

fn column_sql(name: &str, c: &Json) -> String {
    let ty = match c["type"].as_str().unwrap_or("text") {
        "integer" | "boolean" => "INTEGER",
        "real" => "REAL",
        _ => "TEXT",
    };
    let mut sql = format!("{} {ty}", q(name));
    if c["primaryKey"].as_bool() == Some(true) {
        sql.push_str(" PRIMARY KEY");
        if c["autoIncrement"].as_bool() == Some(true) {
            sql.push_str(" AUTOINCREMENT");
        }
    }
    if c["notNull"].as_bool() == Some(true) {
        sql.push_str(" NOT NULL");
    }
    if c["unique"].as_bool() == Some(true) {
        sql.push_str(" UNIQUE");
    }
    if let Some(d) = c["sqlDefault"].as_str() {
        sql.push_str(&format!(" DEFAULT {d}"));
    }
    if let Some(r) = c["references"].as_object() {
        sql.push_str(&format!(
            " REFERENCES {}({})",
            q(r["table"].as_str().unwrap_or_default()),
            q(r["column"].as_str().unwrap_or_default())
        ));
        if let Some(a) = r["onDelete"].as_str() {
            sql.push_str(&format!(" ON DELETE {}", a.to_uppercase()));
        }
        if let Some(a) = r["onUpdate"].as_str() {
            sql.push_str(&format!(" ON UPDATE {}", a.to_uppercase()));
        }
    }
    sql
}

fn create_table(table: &str, cols: &serde_json::Map<String, Json>) -> String {
    let body: Vec<String> = cols.iter().map(|(n, c)| format!("  {}", column_sql(n, c))).collect();
    format!("CREATE TABLE {} (\n{}\n);", q(table), body.join(",\n"))
}

/// Statements that turn `prev` into `next`. Empty when nothing changed.
pub fn plan(prev: &Json, next: &Json) -> Vec<String> {
    let empty = serde_json::Map::new();
    let prev_t = prev["tables"].as_object().unwrap_or(&empty);
    let next_t = next["tables"].as_object().unwrap_or(&empty);
    let mut out = Vec::new();
    // New tables, in dependency order (referenced tables first).
    let mut created: Vec<&String> = Vec::new();
    let mut pending: Vec<&String> = next_t.keys().filter(|t| !prev_t.contains_key(*t)).collect();
    while !pending.is_empty() {
        let before = pending.len();
        pending.retain(|t| {
            let deps_ready = next_t[*t]["columns"].as_object().unwrap_or(&empty).values().all(|c| {
                c["references"]["table"].as_str().is_none_or(|dep| {
                    dep == t.as_str() || prev_t.contains_key(dep) || created.iter().any(|x| x.as_str() == dep)
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
        out.push(create_table(t, next_t[t]["columns"].as_object().unwrap_or(&empty)));
    }
    for (t, next_def) in next_t {
        let Some(prev_def) = prev_t.get(t) else { continue };
        let pc = prev_def["columns"].as_object().unwrap_or(&empty);
        let nc = next_def["columns"].as_object().unwrap_or(&empty);
        if pc == nc {
            continue;
        }
        let only_additions = pc.iter().all(|(k, v)| nc.get(k) == Some(v));
        let addable = nc.iter().filter(|(k, _)| !pc.contains_key(*k)).all(|(_, c)| {
            // SQLite ADD COLUMN can't add PRIMARY KEY/UNIQUE, or NOT NULL without a default.
            c["primaryKey"].as_bool() != Some(true)
                && c["unique"].as_bool() != Some(true)
                && (c["notNull"].as_bool() != Some(true) || c["sqlDefault"].is_string())
        });
        if only_additions && addable {
            for (k, c) in nc.iter().filter(|(k, _)| !pc.contains_key(*k)) {
                out.push(format!("ALTER TABLE {} ADD COLUMN {};", q(t), column_sql(k, c)));
            }
            continue;
        }
        // Rebuild: copy the columns both versions share.
        let tmp = format!("__new_{t}");
        out.push(create_table(&tmp, nc));
        let shared: Vec<String> = nc.keys().filter(|k| pc.contains_key(*k)).map(|k| q(k)).collect();
        if !shared.is_empty() {
            out.push(format!(
                "INSERT INTO {} ({cols}) SELECT {cols} FROM {};",
                q(&tmp),
                q(t),
                cols = shared.join(", ")
            ));
        }
        out.push(format!("DROP TABLE {};", q(t)));
        out.push(format!("ALTER TABLE {} RENAME TO {};", q(&tmp), q(t)));
    }
    for t in prev_t.keys().filter(|t| !next_t.contains_key(*t)) {
        out.push(format!("DROP TABLE {};", q(t)));
    }
    out
}

/// Human-readable warnings for changes that can lose data.
pub fn destructive(prev: &Json, next: &Json) -> Vec<String> {
    let empty = serde_json::Map::new();
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
        json!({ "version": 1, "tables": tables })
    }

    fn col(ty: &str) -> Json {
        json!({ "type": ty, "notNull": false, "primaryKey": false, "autoIncrement": false, "unique": false, "sqlDefault": null, "references": null })
    }

    #[test]
    fn creates_referenced_tables_first_then_adds_then_rebuilds() {
        let id = json!({ "type": "integer", "notNull": true, "primaryKey": true, "autoIncrement": true, "unique": false, "sqlDefault": null, "references": null });
        let mut fk = col("integer");
        fk["references"] = json!({ "table": "locations", "column": "id", "onDelete": "set null", "onUpdate": null });
        let v1 = snap(json!({
            "items": { "columns": { "id": id, "locationId": fk } },
            "locations": { "columns": { "id": id } },
        }));
        let first = plan(&snap(json!({})), &v1);
        assert!(first[0].starts_with("CREATE TABLE \"locations\""), "{first:?}");
        assert!(
            first[1].contains("REFERENCES \"locations\"(\"id\") ON DELETE SET NULL"),
            "{first:?}"
        );

        // Adding a nullable column is an ALTER; making it NOT NULL is a rebuild.
        let mut v2 = v1.clone();
        v2["tables"]["items"]["columns"]["note"] = col("text");
        assert_eq!(
            plan(&v1, &v2),
            vec!["ALTER TABLE \"items\" ADD COLUMN \"note\" TEXT;".to_string()]
        );

        let mut v3 = v2.clone();
        v3["tables"]["items"]["columns"]["note"]["notNull"] = json!(true);
        let rebuild = plan(&v2, &v3);
        assert_eq!(rebuild.len(), 4, "{rebuild:?}");
        assert!(rebuild[1].starts_with("INSERT INTO \"__new_items\""));
        assert_eq!(rebuild[3], "ALTER TABLE \"__new_items\" RENAME TO \"items\";");
        assert!(plan(&v3, &v3).is_empty());
    }
}
