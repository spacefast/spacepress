//! The generated app plugin, `first-app-<name>`: every file in it, as (path below the plugins
//! directory, bytes). `first build` writes these files (`emit::emit_generated`) and the browser
//! compiler returns them (`wasm::compile`), so both make the same plugin. Its templates are compiled
//! in here, not read from the embedded runtime, which the browser build doesn't carry.

use crate::{pipeline::Built, platform, schema};

const TEMPLATE: &str = include_str!("../runtime/wp-plugin/first-app.php");
const UNINSTALL: &[u8] = include_bytes!("../runtime/wp-plugin/first-app-uninstall.php");
const LICENSE: &[u8] = include_bytes!("../runtime/First/LICENSE");

/// The app plugin's files. `migrations` are the ledger's files by name (only `.sql` ones go in);
/// `public` holds the project's `public/` files by path below it.
pub(crate) fn files(
    built: &Built,
    schema_php: &str,
    migrations: impl IntoIterator<Item = (String, Vec<u8>)>,
    public: impl IntoIterator<Item = (String, Vec<u8>)>,
) -> Vec<(String, Vec<u8>)> {
    let slug = format!("first-app-{}", built.schema.name);
    let vars = plugin_vars(&built.schema, schema_php);
    let at = |rel: &str| format!("{slug}/{rel}");
    let mut files = vec![
        (at(&format!("{slug}.php")), substitute(TEMPLATE, &vars).into_bytes()),
        (at("uninstall.php"), UNINSTALL.to_vec()),
        (at("readme.txt"), readme(&slug).into_bytes()),
        // The app plugin declares GPL-2.0-or-later like the runtime it extends; carry the text.
        (at("LICENSE"), LICENSE.to_vec()),
        (at("first/app/schema.php"), schema_php.as_bytes().to_vec()),
    ];
    if let Some(wpml) = crate::wpml_config::render(&built.schema) {
        files.push((at("wpml-config.xml"), wpml.into_bytes()));
    }
    files.push((at("first/app/functions.php"), built.functions_php.as_bytes().to_vec()));
    // Compiled `"use client"` stores, which the page loads as script modules (generator B).
    for island in built.schema.islands.values() {
        files.push((
            at(&format!("first/app/client/{}", island.file)),
            island.source.as_bytes().to_vec(),
        ));
    }
    for (name, sql) in migrations {
        if name.ends_with(".sql") && !name.contains('/') {
            files.push((at(&format!("first/app/migrations/{name}")), sql));
        }
    }
    for (rel, bytes) in public {
        files.push((at(&format!("public/{rel}")), bytes));
    }
    files
}

/// First's plugins for this app, in the order WordPress must activate them: the runtime, then the
/// plugins that require it.
pub(crate) fn first_plugins(schema: &schema::Schema) -> Vec<String> {
    let mut slugs = vec![
        "first-runtime".to_string(),
        "first-identity".to_string(),
        format!("first-app-{}", schema.name),
    ];
    if schema.admin {
        slugs.push("first-admin".to_string());
    }
    slugs
}

pub(crate) fn readme(slug: &str) -> String {
    format!(
        "=== {slug} ===\nStable tag: {}\nLicense: GPL-2.0-or-later\n",
        env!("CARGO_PKG_VERSION")
    )
}

pub(crate) fn plugin_vars(schema: &schema::Schema, schema_php: &str) -> Vec<(&'static str, String)> {
    let hash = {
        // FNV-1a: a stable fingerprint of the built schema (changes when the plugin must migrate).
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in schema_php.bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        format!("{h:016x}")
    };
    let label = schema::title_case(&schema.name);
    vec![
        ("name", schema.name.clone()),
        ("slug", format!("first-app-{}", schema.name)),
        ("runtimeSeries", platform::SERIES.to_string()),
        ("wpVersion", platform::WORDPRESS.to_string()),
        ("phpVersion", platform::PHP.to_string()),
        (
            "requires",
            platform::plugins(schema.locales.is_some())
                .into_iter()
                .map(|p| p.slug)
                .chain(["first-runtime".to_string()])
                .collect::<Vec<_>>()
                .join(", "),
        ),
        ("label", label.clone()),
        ("Name", label),
        ("version", env!("CARGO_PKG_VERSION").to_string()),
        ("schemaHash", hash),
        ("firstVersion", env!("CARGO_PKG_VERSION").to_string()),
    ]
}

/// `{{key}}` → value. Unknown placeholders are left as they are.
pub(crate) fn substitute(text: &str, vars: &[(&'static str, String)]) -> String {
    let mut out = text.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}
