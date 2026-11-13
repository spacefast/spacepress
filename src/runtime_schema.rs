//! The runtime schema lock (`first/_generated/runtime-schema.json`, docs/spec/spec.md §2.10).
//!
//! A site with `runtimeSchema: true` can add fields to its collections while it runs; `first pull`
//! writes the site's active version here. This module declares those fields in the build, as if
//! they were authored, so a build made after a pull contains them.
//!
//! The lock holds field definitions in the compiled vocabulary (the column array of `schema.php`).
//! Each one is turned into the builder call an author would write (`text().optional().max(80)`)
//! and goes through the evaluator's and the extractor's own rules, so a lock field is checked by
//! the code that checks an authored one and nothing here restates a rule. The same definitions are
//! checked on the site by `First\RuntimeSchema\Validator`; `tests/runtime-schema/corpus.json` runs
//! against both.

use crate::diag::{Code, Diag, Span};
use crate::eval::Evaluator;
use crate::extract::Extracted;
use crate::loader::Program;
use crate::schema::{ColType, Column, DefaultKind, RuntimeSchema};
use crate::value::Value;
use indexmap::IndexMap;
use serde_json::{Map, Value as Json};

/// Relative to the directory that holds `first.config.ts`.
pub const LOCK: &str = "first/_generated/runtime-schema.json";
/// The stored format this compiler reads and the runtime writes.
pub const FORMAT: u64 = 1;

/// Keys of a stored field definition, in the order `schema.php` writes them.
const FIELD_KEYS: &[&str] = &[
    "type",
    "multiple",
    "multiline",
    "accept",
    "notNull",
    "enum",
    "default",
    "rules",
    "fields",
    "layouts",
    "ui",
];

fn refuse(at: &str, message: impl std::fmt::Display) -> Diag {
    Diag::new(Span::NONE, format!("{LOCK}: {at}: {message}")).code(Code::Schema)
}

fn located(at: &str, diag: Diag, phase: Code) -> Diag {
    Diag {
        message: format!("{LOCK}: {at}: {}", diag.message),
        span: Span::NONE,
        ..diag
    }
    .phase(phase)
}

/// Declares the lock's fields on the collections `extract` produced. Does nothing, and reads
/// nothing, unless the project set `runtimeSchema: true`.
pub fn apply(program: &Program, ev: &mut Evaluator<'_>, ext: &mut Extracted) -> Result<(), Diag> {
    if ext.schema.runtime_schema.is_none() {
        return Ok(());
    }
    let path = program.root.join(LOCK);
    if !program.fs.exists(&path) {
        return Ok(());
    }
    let text = program
        .fs
        .read_to_string(&path)
        .map_err(|e| Diag::new(Span::NONE, format!("can't read {LOCK}: {e}")).code(Code::Import))?;
    let lock: Json = serde_json::from_str(&text)
        .map_err(|e| Diag::new(Span::NONE, format!("{LOCK} isn't valid JSON: {e}")).code(Code::Schema))?;
    let top = lock
        .as_object()
        .ok_or_else(|| refuse("lock", "must be a JSON object"))?;
    if top.get("format").and_then(Json::as_u64) != Some(FORMAT) {
        return Err(refuse(
            "format",
            format!(
                "this compiler reads format {FORMAT}, not {}",
                top.get("format").unwrap_or(&Json::Null)
            ),
        )
        .help("run `first pull` with this First version to rewrite the lock"));
    }
    for key in top.keys() {
        if !["format", "version", "hash", "collections"].contains(&key.as_str()) {
            return Err(refuse("lock", format!("has no key `{key}`")));
        }
    }
    let version = top
        .get("version")
        .and_then(Json::as_u64)
        .ok_or_else(|| refuse("version", "must be the site's schema version number"))?;
    let hash = top
        .get("hash")
        .and_then(Json::as_str)
        .ok_or_else(|| refuse("hash", "must be the site's schema version hash"))?;
    let empty = Map::new();
    let collections = match top.get("collections") {
        None => &empty,
        Some(Json::Object(collections)) => collections,
        Some(_) => return Err(refuse("collections", "must be an object of collections")),
    };
    for (kind, entry) in collections {
        let columns = entry
            .as_object()
            .filter(|entry| entry.keys().all(|key| key == "columns"))
            .and_then(|entry| entry.get("columns"))
            .and_then(Json::as_object)
            .ok_or_else(|| refuse(kind, "must be `{ \"columns\": { ... } }`"))?;
        let Some(collection) = ext.schema.collections.get(kind) else {
            return Err(
                refuse(kind, "this project declares no collection with that name").help(format!(
                    "declare `{kind}` in the project's schema, or run `first pull` again if the site no longer has it"
                )),
            );
        };
        if !collection.editor {
            return Err(refuse(
                kind,
                "runtime fields belong to collection() kinds; this one stores its rows elsewhere",
            ));
        }
        for (name, definition) in columns {
            let at = format!("{kind}.{name}");
            let column = field(ev, ext, kind, name, definition, &at)?;
            let declared = &ext.schema.collections[kind].columns;
            match declared.get(name) {
                // Declared in source as well, with the same stored definition: one field.
                Some(authored) if definition_of(authored).as_ref() == Some(definition) => {}
                Some(_) => {
                    return Err(refuse(&at, format!("`{name}` is already a field of `{kind}`")).help(format!(
                        "the project's source declares `{name}` differently; keep one definition, then run `first pull`"
                    )));
                }
                None if ext.schema.collections[kind].relations.contains_key(name) => {
                    return Err(refuse(&at, format!("`{name}` is already a relation of `{kind}`")));
                }
                None => {
                    let collection = ext.schema.collections.get_mut(kind).expect("collection");
                    collection.columns.insert(name.clone(), column);
                }
            }
        }
    }
    ext.schema.runtime_schema = Some(RuntimeSchema {
        version,
        hash: hash.to_string(),
    });
    Ok(())
}

/// One top-level lock field as a compiled column.
fn field(
    ev: &mut Evaluator<'_>,
    ext: &mut Extracted,
    kind: &str,
    name: &str,
    definition: &Json,
    at: &str,
) -> Result<Column, Diag> {
    // The body, the title and the slug are designations a build infers from source; a lock field
    // with one of these names would change meaning the day it moved into source.
    if ["title", "content", "slug"].contains(&name) {
        return Err(refuse(
            at,
            format!("`{name}` names a designated field; declare it in source"),
        ));
    }
    let builder = builder(ev, definition, at)?;
    crate::extract::lock_column(name, &builder, kind, ev, ext).map_err(|d| located(at, d, Code::Schema))
}

/// The builder an author would have written for a stored definition. Checks the definition's shape
/// only; every rule about what a field may be is the evaluator's and the extractor's.
fn builder(ev: &Evaluator<'_>, definition: &Json, at: &str) -> Result<std::rc::Rc<crate::value::ColBuilder>, Diag> {
    let def = definition
        .as_object()
        .ok_or_else(|| refuse(at, "a field definition must be an object"))?;
    for key in def.keys() {
        if !FIELD_KEYS.contains(&key.as_str()) {
            return Err(refuse(at, format!("a stored field has no key `{key}`")));
        }
    }
    let ty = def
        .get("type")
        .and_then(Json::as_str)
        .ok_or_else(|| refuse(at, "a field definition needs a `type`"))?;
    let flag = |key: &str| match def.get(key) {
        None => Ok(false),
        Some(Json::Bool(on)) => Ok(*on),
        Some(_) => Err(refuse(at, format!("`{key}` must be true or false"))),
    };
    let only = |key: &str, types: &[&str]| {
        if def.contains_key(key) && !types.contains(&ty) {
            return Err(refuse(at, format!("`{key}` doesn't apply to a `{ty}` field")));
        }
        Ok(())
    };
    only("multiline", &["text"])?;
    only("accept", &["media", "mediaList"])?;
    only("enum", &["text", "select"])?;
    only("fields", &["group", "repeater"])?;
    only("layouts", &["blocks"])?;
    if flag("multiple")? != (ty == "select") {
        return Err(refuse(
            at,
            "`multiple` is true on a `select` field and absent elsewhere",
        ));
    }
    let options = match def.get("enum") {
        None if ty == "select" => return Err(refuse(at, "a `select` field needs `enum`")),
        None => None,
        Some(Json::Array(items)) if items.iter().all(Json::is_string) => {
            Some(Value::array(items.iter().map(value).collect()))
        }
        // PHP reads `{}` and `[]` as the same empty array, so both are the empty list here too.
        Some(Json::Object(items)) if items.is_empty() => Some(Value::array(Vec::new())),
        Some(_) => return Err(refuse(at, "`enum` must be a list of strings")),
    };
    if options.is_some() && def.contains_key("multiline") {
        return Err(refuse(at, "`multiline` doesn't apply to a field with `enum`"));
    }
    let fields = |fields: Option<&Json>, at: &str| -> Result<Value, Diag> {
        let fields = fields
            .and_then(Json::as_object)
            .filter(|fields| !fields.is_empty())
            .ok_or_else(|| refuse(at, "needs at least one field"))?;
        let mut out = IndexMap::new();
        for (name, sub) in fields {
            out.insert(name.clone(), Value::Column(builder(ev, sub, &format!("{at}.{name}"))?));
        }
        Ok(Value::object(out))
    };
    let mut many = false;
    let (name, args): (&'static str, Vec<Value>) = match ty {
        "text" if options.is_some() => ("select", vec![options.expect("options")]),
        "text" if flag("multiline")? => (
            "text",
            vec![Value::object(IndexMap::from([(
                "multiline".to_string(),
                Value::Bool(true),
            )]))],
        ),
        "text" => ("text", vec![]),
        "select" => {
            many = true;
            ("select", vec![options.expect("options")])
        }
        "integer" => ("integer", vec![]),
        "real" => ("number", vec![]),
        "boolean" => ("boolean", vec![]),
        "date" => ("date", vec![]),
        "timestamp" => ("timestamp", vec![]),
        "json" => ("json", vec![]),
        "email" => ("email", vec![]),
        "url" => ("url", vec![]),
        "richText" => ("richText", vec![]),
        "media" | "mediaList" => {
            many = ty == "mediaList";
            match def.get("accept") {
                None => ("media", vec![]),
                Some(accept @ Json::String(_)) => (
                    "media",
                    vec![Value::object(IndexMap::from([("accept".to_string(), value(accept))]))],
                ),
                Some(_) => return Err(refuse(at, "`accept` is \"image\" or \"any\"")),
            }
        }
        "group" => ("group", vec![fields(def.get("fields"), at)?]),
        "repeater" => ("repeater", vec![fields(def.get("fields"), at)?]),
        "blocks" => {
            let Some(layouts) = def.get("layouts").and_then(Json::as_object).filter(|l| !l.is_empty()) else {
                return Err(refuse(at, "a `blocks` field needs at least one layout in `layouts`"));
            };
            let mut out = IndexMap::new();
            for (layout, sub) in layouts {
                out.insert(layout.clone(), fields(Some(sub), &format!("{at}.{layout}"))?);
            }
            ("blocks", vec![Value::object(out)])
        }
        other => {
            return Err(refuse(
                at,
                format!("`{other}` fields can't be stored in the lock; declare it in source"),
            ));
        }
    };
    let mut modifiers: Vec<(&str, Vec<Value>)> = Vec::new();
    if many {
        modifiers.push(("many", vec![]));
    }
    if !flag("notNull")? {
        modifiers.push(("optional", vec![]));
    }
    if let Some(rules) = def.get("rules") {
        let rules = rules
            .as_object()
            .filter(|rules| !rules.is_empty() && rules.keys().all(|key| key == "min" || key == "max"))
            .ok_or_else(|| refuse(at, "`rules` holds `min` and `max` only"))?;
        for key in ["min", "max"] {
            match rules.get(key) {
                None => {}
                Some(n @ Json::Number(_)) => modifiers.push((key, vec![value(n)])),
                Some(_) => return Err(refuse(at, format!("`rules.{key}` must be a number"))),
            }
        }
    }
    if let Some(default) = def.get("default") {
        let default = default
            .as_object()
            .filter(|default| default.len() == 1)
            .ok_or_else(|| refuse(at, "`default` is `{ \"value\": ... }` or `{ \"now\": true }`"))?;
        match (default.get("value"), default.get("now")) {
            // One value: `schema.php` writes a list or object default in a second form as well, which
            // a stored definition doesn't carry. Those are declared in source.
            (Some(literal), None) if literal.is_boolean() || literal.is_number() || literal.is_string() => {
                modifiers.push(("default", vec![value(literal)]));
            }
            (None, Some(Json::Bool(true))) => modifiers.push(("defaultNow", vec![])),
            _ => {
                return Err(refuse(
                    at,
                    "`default` is `{ \"value\": ... }` with one string, number or boolean, or `{ \"now\": true }`",
                ));
            }
        }
    }
    // An empty `ui` is no `ui` (PHP can't tell `{}` from `[]`).
    let empty = |v: &Json| v.as_object().is_some_and(Map::is_empty) || v.as_array().is_some_and(Vec::is_empty);
    if let Some(ui) = def.get("ui").filter(|ui| !empty(ui)) {
        modifiers.push(("ui", vec![value(ui)]));
    }
    ev.field_from_data(name, &args, &modifiers, Span::NONE)
        .map_err(|d| located(at, d, Code::Evaluation))
}

fn value(json: &Json) -> Value {
    match json {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Num(n.as_f64().unwrap_or(f64::NAN)),
        Json::String(s) => Value::str(s),
        Json::Array(items) => Value::array(items.iter().map(value).collect()),
        Json::Object(map) => Value::object(map.iter().map(|(k, v)| (k.clone(), value(v))).collect()),
    }
}

/// A compiled column as the lock stores it: the array `schema.php` holds for it, as JSON. `None`
/// for a column the lock can't express (a function, a reference, an access rule, ...), which is
/// therefore never equal to a stored definition.
pub fn definition_of(column: &Column) -> Option<Json> {
    if column.primary_key
        || column.auto_increment
        || column.unique
        || column.system
        || column.localized
        || column.derived
        || column.hidden
        || column.source.is_some()
        || column.on_update.is_some()
        || column.references.is_some()
        || column.rules.pattern.is_some()
        || column.rules.validate.is_some()
        || column.show_if.is_some()
        || column.bucket.is_some()
        || column.was.is_some()
        || !column.access.is_empty()
        || matches!(column.ty, ColType::Slug | ColType::File)
    {
        return None;
    }
    let number = |n: f64| {
        if crate::num::is_safe_int(n) {
            Json::from(n as i64)
        } else {
            Json::from(n)
        }
    };
    let fields = |fields: &IndexMap<String, Column>| -> Option<Json> {
        let mut out = Map::new();
        for (name, sub) in fields {
            out.insert(name.clone(), definition_of(sub)?);
        }
        Some(Json::Object(out))
    };
    let options = column.enum_values.as_ref().map(|options| Json::from(options.clone()));
    let mut out = Map::new();
    out.insert("type".into(), column.ty.name().into());
    if column.ty == ColType::Select {
        out.insert("multiple".into(), true.into());
        out.insert("enum".into(), options.clone()?);
    }
    if column.multiline {
        out.insert("multiline".into(), true.into());
    }
    if let Some(accept) = &column.accept {
        out.insert("accept".into(), accept.clone().into());
    }
    if column.not_null {
        out.insert("notNull".into(), true.into());
    }
    if column.ty != ColType::Select
        && let Some(options) = options
    {
        out.insert("enum".into(), options);
    }
    match &column.default {
        None => {}
        Some(DefaultKind::Now) => {
            out.insert("default".into(), serde_json::json!({ "now": true }));
        }
        Some(DefaultKind::Value(literal)) if literal.is_boolean() || literal.is_number() || literal.is_string() => {
            out.insert("default".into(), serde_json::json!({ "value": literal }));
        }
        Some(_) => return None,
    }
    if !column.rules.is_empty() {
        let mut rules = Map::new();
        if let Some(min) = column.rules.min {
            rules.insert("min".into(), number(min));
        }
        if let Some(max) = column.rules.max {
            rules.insert("max".into(), number(max));
        }
        out.insert("rules".into(), Json::Object(rules));
    }
    if let Some(sub) = &column.fields {
        out.insert("fields".into(), fields(sub)?);
    }
    if let Some(layouts) = &column.layouts {
        let mut map = Map::new();
        for (layout, sub) in layouts {
            map.insert(layout.clone(), fields(sub)?);
        }
        out.insert("layouts".into(), Json::Object(map));
    }
    if let Some(ui) = column
        .ui
        .as_ref()
        .filter(|ui| **ui != crate::schema::FieldUi::default())
    {
        out.insert("ui".into(), serde_json::to_value(ui).expect("field UI serializes"));
    }
    Some(Json::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::{self, Previous};
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use std::rc::Rc;

    const CORPUS: &str = include_str!("../tests/runtime-schema/corpus.json");
    const CONFIG: &str = include_str!("../tests/runtime-schema/base/first.config.ts");
    const SCHEMA: &str = include_str!("../tests/runtime-schema/base/first/schema.ts");

    /// Compiles the corpus base project with `lock` (None: no lock file).
    fn build(lock: Option<&Json>) -> Result<crate::schema::Schema, Diag> {
        let project = Path::new("/rtschema");
        let mut files = BTreeMap::from([
            (project.join("first.config.ts"), CONFIG.to_string()),
            (project.join("first/schema.ts"), SCHEMA.to_string()),
        ]);
        if let Some(lock) = lock {
            files.insert(project.join(LOCK), lock.to_string());
        }
        crate::diag::isolated(|| {
            let fs = Rc::new(crate::wasm::Memory::new(files));
            let program = crate::loader::load_from(fs, &project.join("first.config.ts"))
                .map_err(|diagnostics| diagnostics.into_iter().next().expect("a diagnostic"))?;
            pipeline::build(project, &program, || Ok(Previous::none()), |_| None).map(|built| built.schema)
        })
    }

    fn lock_of(kind: &str, field: &str, definition: &Json) -> Json {
        serde_json::json!({ "format": FORMAT, "version": 1, "hash": "h", "collections": { kind: { "columns": { field: definition } } } })
    }

    fn code(diag: &Diag) -> String {
        serde_json::to_value(diag.code)
            .expect("code")
            .as_str()
            .expect("code")
            .to_string()
    }

    /// The compiler's half of the shared corpus: every case it can express gets the verdict and the
    /// diagnostic code the corpus records, and an accepted field compiles to exactly its `stored`
    /// definition. `tests/php/runtimeschema_corpus.php` holds the runtime to the same file.
    #[test]
    fn the_shared_corpus_gets_the_recorded_verdicts_from_the_compiler() {
        let corpus: Json = serde_json::from_str(CORPUS).expect("corpus.json");
        let mut checked = 0;
        for case in corpus["cases"].as_array().expect("cases") {
            let name = case["name"].as_str().expect("name");
            let (kind, field) = (
                case["kind"].as_str().expect("kind"),
                case["field"].as_str().expect("field"),
            );
            // No `compiler`: a change only the running site judges (a field the lock can't hold,
            // which the site refuses as build-only). `runtime` records its verdict.
            let Some(expected) = case.get("compiler") else {
                assert!(case.get("runtime").is_some(), "{name}: needs `compiler` or `runtime`");
                continue;
            };
            checked += 1;
            let result = build(Some(&lock_of(kind, field, &case["definition"])));
            match (expected.as_str(), result) {
                (Some("accept"), Ok(schema)) => {
                    let column = &schema.collections[kind].columns[field];
                    assert_eq!(
                        definition_of(column).as_ref(),
                        Some(&case["stored"]),
                        "{name}: compiled to another definition than the one stored"
                    );
                }
                (Some("accept"), Err(diag)) => panic!("{name}: refused: {} {}", code(&diag), diag.message),
                (Some(expected), Err(diag)) => assert_eq!(code(&diag), expected, "{name}: {}", diag.message),
                (Some(expected), Ok(_)) => panic!("{name}: accepted, expected {expected}"),
                (None, _) => panic!("{name}: `compiler` must be \"accept\" or a diagnostic code"),
            }
        }
        assert!(checked >= 40, "the corpus lost its cases: {checked}");
    }

    #[test]
    fn a_stored_definition_is_what_the_site_stored_so_the_canonical_form_round_trips() {
        let corpus: Json = serde_json::from_str(CORPUS).expect("corpus.json");
        for case in corpus["cases"].as_array().expect("cases") {
            if case.get("compiler").and_then(Json::as_str) != Some("accept") {
                continue;
            }
            let (kind, field) = (
                case["kind"].as_str().expect("kind"),
                case["field"].as_str().expect("field"),
            );
            let schema =
                build(Some(&lock_of(kind, field, &case["stored"]))).unwrap_or_else(|d| panic!("{}", d.message));
            assert_eq!(
                definition_of(&schema.collections[kind].columns[field]).as_ref(),
                Some(&case["stored"]),
                "{}",
                case["name"]
            );
        }
    }

    /// The runtime's half of the corpus runs on this file (tests/php/runtimeschema_corpus.php and
    /// runtimeschema_test.php), so it must be what the compiler emits for the base project today.
    #[test]
    fn the_compiled_schema_the_runtime_suites_use_is_the_base_projects() {
        let schema = build(None).unwrap_or_else(|d| panic!("{}", d.message));
        assert_eq!(
            crate::schema_php::render(&schema),
            include_str!("../tests/runtime-schema/base.schema.php"),
            "tests/runtime-schema/base.schema.php drifted: run `first build` on a copy of tests/runtime-schema/base \
             and copy first/dist/wp-content/plugins/first-app-rtschema/first/app/schema.php over it"
        );
    }

    #[test]
    fn without_the_flag_the_lock_is_not_read() {
        let project = PathBuf::from("/rtschema");
        let files = BTreeMap::from([
            (
                project.join("first.config.ts"),
                CONFIG.replace("runtimeSchema: true", "runtimeSchema: false"),
            ),
            (project.join("first/schema.ts"), SCHEMA.to_string()),
            (project.join(LOCK), "not json".to_string()),
        ]);
        let schema = crate::diag::isolated(|| {
            let program = crate::loader::load_from(
                Rc::new(crate::wasm::Memory::new(files)),
                &project.join("first.config.ts"),
            )
            .map_err(|d| d.into_iter().next().expect("a diagnostic"))?;
            pipeline::build(&project, &program, || Ok(Previous::none()), |_| None).map(|built| built.schema)
        })
        .unwrap_or_else(|d| panic!("{}", d.message));
        assert_eq!(schema.runtime_schema, None);
        assert!(!crate::schema_php::render(&schema).contains("runtimeSchema"));
    }

    #[test]
    fn the_build_records_the_version_it_contains() {
        let schema = build(None).unwrap_or_else(|d| panic!("{}", d.message));
        assert_eq!(schema.runtime_schema, Some(RuntimeSchema::default()));
        let lock = serde_json::json!({ "format": FORMAT, "version": 7, "hash": "abc", "collections": {
            "articles": { "columns": { "subtitle": { "type": "text", "rules": { "max": 120 } } } } } });
        let schema = build(Some(&lock)).unwrap_or_else(|d| panic!("{}", d.message));
        assert_eq!(
            schema.runtime_schema,
            Some(RuntimeSchema {
                version: 7,
                hash: "abc".into()
            })
        );
        let php = crate::schema_php::render(&schema);
        assert!(
            php.contains("'runtimeSchema' => ['version' => 7, 'hash' => 'abc'],"),
            "{php}"
        );
        assert!(
            php.contains("'subtitle' => ['type' => 'text', 'rules' => ['max' => 120]],"),
            "{php}"
        );
    }

    #[test]
    fn a_field_declared_in_source_and_in_the_lock_is_one_field_when_both_agree() {
        // `rating` is `integer().optional()` in the base project.
        let same = lock_of("articles", "rating", &serde_json::json!({ "type": "integer" }));
        let schema = build(Some(&same)).unwrap_or_else(|d| panic!("{}", d.message));
        assert_eq!(
            schema.collections["articles"]
                .columns
                .keys()
                .filter(|k| *k == "rating")
                .count(),
            1
        );
        let other = lock_of("articles", "rating", &serde_json::json!({ "type": "text" }));
        let refused = build(Some(&other)).expect_err("a different definition is refused");
        assert_eq!(code(&refused), "F3001");
        assert!(
            refused.message.contains("`rating` is already a field of `articles`"),
            "{}",
            refused.message
        );
    }

    #[test]
    fn a_lock_field_named_like_a_relation_of_its_kind_is_refused() {
        let project = PathBuf::from("/rtschema");
        let schema = "import { collection, table, text, integer, defineRelations } from \"first\";\n\
            export const articles = collection({ title: text() });\n\
            export const votes = table({ articleId: integer().references(() => articles.id) });\n\
            export const relations = defineRelations({ articles, votes }, (r) => ({ articles: { votes: r.many.votes() },\n\
              votes: { article: r.one.articles({ from: r.votes.articleId, to: r.articles.id }) } }));\n";
        let config = "import { defineConfig } from \"first\";\nimport { relations } from \"./first/schema\";\n\
            export default defineConfig({ name: \"rtschema\", runtimeSchema: true, relations });\n";
        let lock = lock_of("articles", "votes", &serde_json::json!({ "type": "text" }));
        let files = BTreeMap::from([
            (project.join("first.config.ts"), config.to_string()),
            (project.join("first/schema.ts"), schema.to_string()),
            (project.join(LOCK), lock.to_string()),
        ]);
        let refused = crate::diag::isolated(|| {
            let program = crate::loader::load_from(
                Rc::new(crate::wasm::Memory::new(files)),
                &project.join("first.config.ts"),
            )
            .map_err(|d| d.into_iter().next().expect("a diagnostic"))?;
            pipeline::build(&project, &program, || Ok(Previous::none()), |_| None).map(|built| built.schema)
        })
        .expect_err("a field named like a relation");
        assert_eq!(code(&refused), "F3001", "{}", refused.message);
        assert!(
            refused.message.contains("`votes` is already a relation of `articles`"),
            "{}",
            refused.message
        );
    }

    #[test]
    fn a_lock_this_compiler_cannot_read_is_refused_with_the_command_that_rewrites_it() {
        for (lock, expected) in [
            (
                serde_json::json!({ "format": 2, "version": 1, "hash": "h" }),
                "reads format 1, not 2",
            ),
            (
                serde_json::json!({ "format": 1, "hash": "h" }),
                "version: must be the site's schema version number",
            ),
            (
                serde_json::json!({ "format": 1, "version": 1, "hash": "h", "collections": { "missing": { "columns": {} } } }),
                "missing: this project declares no collection with that name",
            ),
            (
                serde_json::json!({ "format": 1, "version": 1, "hash": "h", "collections": { "votes": { "columns": {} } } }),
                "votes: runtime fields belong to collection() kinds",
            ),
            (
                serde_json::json!({ "format": 1, "version": 1, "hash": "h", "extra": 1 }),
                "has no key `extra`",
            ),
        ] {
            let refused = build(Some(&lock)).expect_err(expected);
            assert_eq!(code(&refused), "F3001", "{}", refused.message);
            assert!(refused.message.contains(expected), "{}", refused.message);
        }
    }
}
