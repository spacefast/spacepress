//! WordPress abilities from `"php/wordpress"`: the committed lock `zero/abilities.json`, its JSON
//! Schemas as compiler types and TypeScript, and the app's own abilities typed from the schema.
//!
//! The lock is written by `zero abilities pull` (src/commands/abilities.rs). Building reads only the
//! lock; nothing here touches the network.

use crate::schema::Schema;
use crate::types::{self, Ty};
use indexmap::IndexMap;
use serde_json::Value;
use std::collections::BTreeMap;

/// Where the lock lives in a project.
pub const LOCK: &str = "zero/abilities.json";

/// One locked ability: what `GET /wp-abilities/v1/abilities` returned for it.
#[derive(Debug, Clone)]
pub struct Locked {
    pub name: String,
    pub input: Value,
    pub output: Value,
}

/// Every ability a call can name: the app's own and the lock's. Own abilities win a name clash: the
/// app registers them, so the lock's copy is a stale pull of the same thing.
#[derive(Debug, Default, Clone)]
pub struct Catalog {
    pub abilities: BTreeMap<String, (Ty, Ty)>,
}

impl Catalog {
    pub fn new(schema: &Schema, locked: &[Locked]) -> Self {
        let mut abilities = BTreeMap::new();
        for a in locked {
            abilities.insert(
                a.name.clone(),
                (
                    schema_ty(&a.input, &mut Vec::new(), ""),
                    schema_ty(&a.output, &mut Vec::new(), ""),
                ),
            );
        }
        abilities.extend(own(schema));
        Catalog { abilities }
    }
}

/// Parses the lock. A malformed lock is an error, never an empty catalog: a call that typed
/// yesterday would otherwise fail as "unknown ability" with no hint that the file is the problem.
pub fn parse_lock(text: &str) -> Result<Vec<Locked>, String> {
    let lock: Value = serde_json::from_str(text).map_err(|e| format!("{LOCK} is not valid JSON: {e}"))?;
    if lock["version"] != 1 {
        return Err(format!(
            "{LOCK} has version {}; this compiler reads version 1",
            lock["version"]
        ));
    }
    let Some(items) = lock["abilities"].as_array() else {
        return Err(format!("{LOCK} has no `abilities` list"));
    };
    items
        .iter()
        .map(|a| {
            let name = a["name"]
                .as_str()
                .filter(|n| valid_name(n))
                .ok_or_else(|| format!("{LOCK} has an ability without a valid `name` (vendor/name)"))?;
            Ok(Locked {
                name: name.to_string(),
                input: a["input_schema"].clone(),
                output: a["output_schema"].clone(),
            })
        })
        .collect()
}

/// Core's rule for ability names: `namespace/name`, lowercase letters, digits and dashes
/// (`WP_Abilities_Registry::register`).
pub fn valid_name(name: &str) -> bool {
    let mut parts = name.split('/');
    let ok = |p: Option<&str>| {
        p.is_some_and(|p| {
            !p.is_empty()
                && p.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
    };
    ok(parts.next()) && ok(parts.next()) && parts.next().is_none()
}

/// A JSON Schema (draft-04, as WordPress publishes it) as a compiler type. Unrepresentable parts
/// become `unknown` and push `pointer: reason` onto `warnings`.
pub fn schema_ty(s: &Value, warnings: &mut Vec<String>, at: &str) -> Ty {
    let Some(o) = s.as_object() else {
        // `true`, `{}` or a missing schema accept anything.
        return Ty::Unknown;
    };
    if o.is_empty() {
        return Ty::Unknown;
    }
    for k in ["allOf", "$ref", "not", "patternProperties", "if"] {
        if o.contains_key(k) {
            warnings.push(format!("{}: `{k}` is not represented; typed as unknown", pointer(at)));
            return Ty::Unknown;
        }
    }
    if let Some(v) = o.get("const") {
        return literal(v).unwrap_or_else(|| {
            warnings.push(format!("{}: a non-scalar `const` is typed as unknown", pointer(at)));
            Ty::Unknown
        });
    }
    if let Some(values) = o.get("enum").and_then(Value::as_array) {
        let lits: Option<Vec<Ty>> = values.iter().map(literal).collect();
        return match lits {
            Some(lits) => Ty::union(lits),
            None => {
                warnings.push(format!("{}: a non-scalar `enum` is typed as unknown", pointer(at)));
                Ty::Unknown
            }
        };
    }
    for k in ["oneOf", "anyOf"] {
        if let Some(options) = o.get(k).and_then(Value::as_array) {
            return Ty::union(
                options
                    .iter()
                    .enumerate()
                    .map(|(i, option)| schema_ty(option, warnings, &format!("{at}/{k}/{i}"))),
            );
        }
    }
    let types: Vec<&str> = match o.get("type") {
        Some(Value::String(t)) => vec![t.as_str()],
        Some(Value::Array(ts)) => ts.iter().filter_map(Value::as_str).collect(),
        // Properties without a type still describe an object.
        None if o.contains_key("properties") => vec!["object"],
        None => return Ty::Unknown,
        Some(_) => {
            warnings.push(format!("{}: `type` is not a string or list", pointer(at)));
            return Ty::Unknown;
        }
    };
    Ty::union(types.into_iter().map(|t| match t {
        "string" => Ty::Str,
        "integer" | "number" => Ty::Num,
        "boolean" => Ty::Bool,
        "null" => Ty::Null,
        "array" => match o.get("items") {
            Some(items @ Value::Object(_)) => Ty::Array(Box::new(schema_ty(items, warnings, &format!("{at}/items")))),
            None => Ty::Array(Box::new(Ty::Unknown)),
            Some(_) => {
                warnings.push(format!("{}: tuple `items` is typed as unknown[]", pointer(at)));
                Ty::Array(Box::new(Ty::Unknown))
            }
        },
        "object" => object(o, warnings, at),
        other => {
            warnings.push(format!("{}: type `{other}` is typed as unknown", pointer(at)));
            Ty::Unknown
        }
    }))
}

fn object(o: &serde_json::Map<String, Value>, warnings: &mut Vec<String>, at: &str) -> Ty {
    let props = o.get("properties").and_then(Value::as_object);
    if props.is_none_or(|p| p.is_empty()) {
        // No listed properties: a record of whatever additionalProperties allows.
        return Ty::Map(Box::new(match o.get("additionalProperties") {
            Some(extra @ Value::Object(_)) => schema_ty(extra, warnings, &format!("{at}/additionalProperties")),
            _ => Ty::Unknown,
        }));
    }
    let mut required: Vec<&str> = o
        .get("required")
        .and_then(Value::as_array)
        .map(|r| r.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let props = props.expect("properties");
    // Draft-03 `required: true` on a property, which core still accepts.
    required.extend(
        props
            .iter()
            .filter(|(_, p)| p["required"] == Value::Bool(true))
            .map(|(k, _)| k.as_str()),
    );
    Ty::Obj(
        props
            .iter()
            .map(|(k, p)| {
                let t = schema_ty(p, warnings, &format!("{at}/properties/{}", escape(k)));
                (k.clone(), (t, !required.contains(&k.as_str())))
            })
            .collect::<IndexMap<_, _>>(),
    )
}

fn literal(v: &Value) -> Option<Ty> {
    match v {
        Value::String(s) => Some(Ty::StrLit(s.clone())),
        Value::Number(n) => n.as_f64().map(Ty::NumLit),
        Value::Bool(b) => Some(Ty::BoolLit(*b)),
        Value::Null => Some(Ty::Null),
        _ => None,
    }
}

fn pointer(at: &str) -> String {
    if at.is_empty() { "/".into() } else { at.into() }
}

fn escape(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

/// The app's own abilities (runtime/Zero/Wp/Abilities/Register.php names them), typed from the
/// schema. Action results are `unknown`: the registered output schema is empty.
fn own(schema: &Schema) -> Vec<(String, (Ty, Ty))> {
    let app = kebab(&schema.name);
    let mut out = Vec::new();
    let opt = |fields: &[(&str, Ty, bool)]| {
        Ty::Obj(
            fields
                .iter()
                .map(|(k, t, o)| (k.to_string(), (t.clone(), *o)))
                .collect(),
        )
    };
    let list_input = || {
        opt(&[
            ("where", Ty::Unknown, true),
            ("orderBy", Ty::Unknown, true),
            ("limit", Ty::Num, true),
            ("offset", Ty::Num, true),
            ("with", Ty::Unknown, true),
            ("locale", Ty::Str, true),
        ])
    };
    for c in schema.collections.values() {
        let k = kebab(&c.table);
        let row = types::row_of(c);
        let pk = c
            .primary_key()
            .map(|p| types::col_base(p, &types::json_ty, false))
            .unwrap_or(Ty::Num);
        let rows = opt(&[("rows", Ty::Array(Box::new(row.clone())), false)]);
        if c.api.list {
            out.push((format!("{app}/{k}-list"), (list_input(), rows)));
        }
        if c.api.get {
            out.push((
                format!("{app}/{k}-get"),
                (
                    opt(&[
                        ("id", pk.clone(), false),
                        ("with", Ty::Unknown, true),
                        ("locale", Ty::Str, true),
                    ]),
                    row.clone(),
                ),
            ));
        }
        if c.api.create {
            out.push((
                format!("{app}/{k}-create"),
                (types::insert_with(schema, &c.table, &types::json_ty), row.clone()),
            ));
        }
        if c.api.update {
            let patch = types::partial(types::insert_with(schema, &c.table, &types::json_ty));
            out.push((
                format!("{app}/{k}-update"),
                (opt(&[("id", pk.clone(), false), ("patch", patch, false)]), row.clone()),
            ));
        }
        if c.api.delete {
            out.push((format!("{app}/{k}-delete"), (opt(&[("id", pk, false)]), row)));
        }
    }
    for a in schema.actions.values() {
        out.push((
            format!("{app}/{}", kebab(&a.name)),
            (types::action_input(&a.input, &types::json_ty), Ty::Unknown),
        ));
    }
    for (name, g) in &schema.globals {
        let k = kebab(name);
        let values = types::global_row(g);
        out.push((format!("{app}/global-{k}-get"), (opt(&[]), values.clone())));
        out.push((
            format!("{app}/global-{k}-update"),
            (types::partial(values.clone()), values),
        ));
    }
    out
}

/// The runtime's kebab-case (`Register::kebab`, `extract::kebab`).
pub fn kebab(name: &str) -> String {
    let mut s = String::new();
    let chars: Vec<char> = name.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if *c == '_' || *c == '-' {
            if !s.ends_with('-') {
                s.push('-');
            }
        } else {
            if c.is_uppercase()
                && i > 0
                && !s.ends_with('-')
                && (chars[i - 1].is_lowercase()
                    || chars[i - 1].is_ascii_digit()
                    || chars.get(i + 1).is_some_and(|c| c.is_lowercase()))
            {
                s.push('-');
            }
            s.extend(c.to_lowercase());
        }
    }
    s
}

/// The `zero.gen.ts` block that types `abilities.call` for every catalog entry.
pub fn gen_ts(catalog: &Catalog) -> String {
    if catalog.abilities.is_empty() {
        return String::new();
    }
    let mut out = String::from("declare module \"php/wordpress\" {\n  interface Abilities {\n");
    for (name, (input, output)) in &catalog.abilities {
        out.push_str(&format!(
            "    {}: {{ input: {}; output: {} }};\n",
            serde_json::to_string(name).expect("string"),
            crate::client::ty_ts_plain(input),
            crate::client::ty_ts_plain(output)
        ));
    }
    out.push_str("  }\n}\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_schema_maps_what_abilities_use_and_warns_on_the_rest() {
        let mut warnings = Vec::new();
        let ty = schema_ty(
            &json!({
                "type": "object",
                "properties": {
                    "id": { "type": "integer" },
                    "status": { "enum": ["draft", "publish"] },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "note": { "type": ["string", "null"] },
                    "meta": { "type": "object", "additionalProperties": { "type": "boolean" } },
                    "pick": { "oneOf": [{ "type": "string" }, { "type": "number" }] },
                    "legacy": { "type": "string", "required": true },
                    "mixed": { "allOf": [{ "type": "string" }] }
                },
                "required": ["id"]
            }),
            &mut warnings,
            "",
        );
        let Ty::Obj(f) = ty else { panic!("{ty:?}") };
        assert_eq!(f["id"], (Ty::Num, false));
        assert_eq!(
            f["status"].0,
            Ty::union([Ty::StrLit("draft".into()), Ty::StrLit("publish".into())])
        );
        assert_eq!(f["tags"].0, Ty::Array(Box::new(Ty::Str)));
        assert_eq!(f["note"].0, Ty::Str.nullable());
        assert_eq!(f["meta"].0, Ty::Map(Box::new(Ty::Bool)));
        assert_eq!(f["pick"].0, Ty::union([Ty::Str, Ty::Num]));
        assert_eq!(f["legacy"], (Ty::Str, false));
        assert_eq!(f["mixed"], (Ty::Unknown, true));
        assert_eq!(
            warnings,
            ["/properties/mixed: `allOf` is not represented; typed as unknown"]
        );
    }

    #[test]
    fn ability_names_follow_core() {
        assert!(valid_name("woocommerce/create-order"));
        assert!(!valid_name("WooCommerce/create-order"));
        assert!(!valid_name("a/b/c"));
        assert!(!valid_name("nameonly"));
    }
}
