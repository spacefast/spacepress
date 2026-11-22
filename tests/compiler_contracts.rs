//! Executable joins between compatibility claims, diagnostics, authoring and PHP behavior.

// Runs the `typedpress` binary: only with the cli feature (the browser build of the core has none).
#![cfg(feature = "cli")]
use serde_json::{Value, json};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Writes an app module, creating its directory (app code lives under `tp/`).
fn write_app(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    std::fs::create_dir_all(path.as_ref().parent().unwrap())?;
    std::fs::write(path, contents)
}

/// Copies a file into the app, creating its directory.
fn copy_app(from: impl AsRef<Path>, to: impl AsRef<Path>) -> std::io::Result<u64> {
    std::fs::create_dir_all(to.as_ref().parent().unwrap())?;
    std::fs::copy(from, to)
}

/// A project whose app is `source` and the files beside it: the sources go under `tp/` (the only
/// place app code loads from) and the root `typedpress.config.ts` re-exports `source`'s config.
fn project_from(project: &Path, source: &Path, siblings: &[&Path]) {
    let app = project.join("tp");
    std::fs::create_dir_all(&app).unwrap();
    for sibling in siblings {
        std::fs::copy(sibling, app.join(sibling.file_name().unwrap())).unwrap();
    }
    let name = source.file_name().unwrap().to_str().unwrap();
    std::fs::copy(source, app.join(name)).unwrap();
    std::fs::write(
        project.join("typedpress.config.ts"),
        format!("export {{ default }} from \"./tp/{name}\";\n"),
    )
    .unwrap();
}

fn first() -> Command {
    Command::new(env!("CARGO_BIN_EXE_typedpress"))
}

fn checked(project: &Path) -> (Output, Value) {
    let out = first().args(["check", "--json"]).arg(project).output().unwrap();
    let envelope = serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "invalid JSON: {e}\n{}\n{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        )
    });
    assert!(out.stderr.is_empty(), "{}", String::from_utf8_lossy(&out.stderr));
    (out, envelope)
}

fn php(script: &str, args: &[&Path]) -> Value {
    let out = Command::new("php").args(["-r", script]).args(args).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(out.stderr.is_empty(), "{}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
}

fn build_wp(project: &Path) -> PathBuf {
    let output = project.join("tp/dist/wp-content");
    let out = first().arg("build").arg(project).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    output
}

#[test]
fn registered_refusals_have_live_codes_and_no_stale_fixture_links() {
    let registry: Value = serde_json::from_str(include_str!("compatibility/registry.json")).unwrap();
    assert_eq!(registry["version"], 1);
    let mut ids = HashSet::new();
    for entry in registry["entries"].as_array().unwrap() {
        assert!(ids.insert(entry["id"].as_str().unwrap()));
        match entry["status"].as_str().unwrap() {
            "refused" => {
                let (out, report) = checked(&root().join(entry["fixture"].as_str().unwrap()));
                assert_eq!(out.status.code(), Some(1), "{entry}");
                assert_eq!(report["ok"], false);
                assert!(
                    report["diagnostics"].as_array().unwrap().iter().any(|d| {
                        d["code"] == entry["code"]
                            && d["message"]
                                .as_str()
                                .unwrap()
                                .contains(entry["message"].as_str().unwrap())
                    }),
                    "stale registry entry {entry}: {report}"
                );
            }
            "supported" | "divergence" => assert!(root().join(entry["evidence"].as_str().unwrap()).is_file()),
            other => panic!("invalid registry status: {other}"),
        }
    }
    assert!(ids.len() >= 5, "an empty registry cannot certify compatibility");
    let generated = Command::new("python3")
        .arg(root().join("scripts/compiler-contracts.py"))
        .arg("--check")
        .output()
        .unwrap();
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );
}

#[test]
fn json_check_groups_independent_module_errors_and_reports_utf16_columns() {
    let tmp = tempfile::tempdir().unwrap();
    let source = "import './a';\nimport './b';\n/*😀*/ abstract class TypedPress {}\nabstract class Second {}\nconst clock = Date.now();\n";
    let source = source.replace("'./a'", "'./tp/a'").replace("'./b'", "'./tp/b'");
    let source = source.as_str();
    std::fs::write(tmp.path().join("typedpress.config.ts"), source).unwrap();
    for name in ["a.ts", "b.ts"] {
        write_app(tmp.path().join("tp").join(name), "abstract class Imported {}\n").unwrap();
    }
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(report["schema"], "typedpress-diagnostics");
    assert_eq!(report["version"], 1);
    assert_eq!(report["offsetEncoding"], "utf-8");
    assert_eq!(report["positionEncoding"], "utf-16");
    assert_eq!(report["diagnostics"].as_array().unwrap().len(), 4, "{report}");
    assert_eq!(report["groups"].as_array().unwrap().len(), 1);
    assert_eq!(report["groups"][0]["sites"].as_array().unwrap().len(), 4);
    assert!(
        report["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .all(|d| d["code"] == "F1101")
    );
    let loc = &report["diagnostics"][0]["location"];
    assert_eq!(loc["file"], "typedpress.config.ts");
    assert_eq!(loc["start"], source.find("abstract class TypedPress").unwrap());
    assert_eq!(loc["column"], "/*😀*/ ".encode_utf16().count() + 1);
    assert_eq!(loc["line"], 3);
    assert_eq!(report, checked(tmp.path()).1, "diagnostics must be deterministic");
    assert!(!tmp.path().join("tp/_generated").exists() && !tmp.path().join("tp/dist").exists());
    assert!(!tmp.path().join(".tp").exists());
    // A partially lowered program must never run the Date.now() declaration.
    assert!(!report.to_string().contains("F2101"));
    let human = first().arg("check").arg(tmp.path()).output().unwrap();
    assert_eq!(human.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&human.stderr).contains("abstract, ambient or generic classes"));
}

#[test]
fn successful_json_check_and_the_reusable_recipe_write_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    for file in ["typedpress.config.ts", "tp/seo.ts"] {
        copy_app(root().join("examples/recipes").join(file), tmp.path().join(file)).unwrap();
    }
    let (out, report) = checked(tmp.path());
    assert!(out.status.success(), "{report}");
    assert_eq!(report["ok"], true);
    assert_eq!(report["diagnostics"], json!([]));
    assert_eq!(report["groups"], json!([]));
    assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 2);
}

/// `typedpress check --json` lists each SQL index the deploy keeps and why it exists (spec §2.9).
/// A validator receives the input it checks: a `json<string[]>()` value can be an object, so its
/// parameter takes no PHP type and the validator's own `Array.isArray` answers (422, not a TypeError).
#[test]
fn a_validator_parameter_accepts_any_json_value() {
    let tmp = tempfile::tempdir().unwrap();
    write_app(
        tmp.path().join("typedpress.config.ts"),
        "import { defineConfig, json, table } from \"typedpress\";\nexport const things = table({ tags: json<string[]>().$default(() => []).validate((tags) => Array.isArray(tags) || \"Tags must be a list.\") });\nexport default defineConfig({ name: \"tags\" });\n",
    )
    .unwrap();
    let wp = build_wp(tmp.path());
    let functions = std::fs::read_to_string(wp.join("plugins/typedpress-app-tags/tp/app/functions.php")).unwrap();
    assert!(
        functions.contains("function things__validate__tags( $tags )"),
        "{functions}"
    );
    let out = php(
        r#"require $argv[1]; require $argv[2];
        echo json_encode([\TypedPressApp\things__validate__tags(new \TypedPress\JsObject(['a' => true]), new \TypedPress\JsObject())]);"#,
        &[
            &root().join("runtime/TypedPress/bootstrap.php"),
            &wp.join("plugins/typedpress-app-tags/tp/app/functions.php"),
        ],
    );
    assert_eq!(out, json!(["Tags must be a list."]));
}

/// `.index(fields, { unique? })` (spec §2.9): a compound index the migration creates and `typedpress check
/// --json` lists with its reason; a field the kind doesn't have is refused where it is written.
#[test]
fn a_declared_index_is_created_and_listed() {
    let tmp = tempfile::tempdir().unwrap();
    write_app(
        tmp.path().join("typedpress.config.ts"),
        "import { defineConfig } from \"typedpress\";\nexport default defineConfig({ name: \"likes\" });\n",
    )
    .unwrap();
    write_app(
        tmp.path().join("tp/schema.ts"),
        "import { table, integer } from \"typedpress\";\nexport const likes = table({ post: integer(), author: integer() }).index([\"post\", \"author\"], { unique: true });\n",
    )
    .unwrap();
    let (out, report) = checked(tmp.path());
    assert!(out.status.success(), "{report}");
    assert!(
        report["indexes"].as_array().unwrap().contains(&json!({ "table": "likes", "name": "idx_post_author", "unique": true, "columns": ["post", "author", "_live"], "reason": "declared with .index([\"post\", \"author\"], { unique: true })" })),
        "{report}"
    );
    let built = first().args(["build", "--quiet"]).arg(tmp.path()).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let init_dir = std::fs::read_dir(tmp.path().join("tp/_generated/migrations"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.is_dir())
        .expect("init migration folder");
    let sql = std::fs::read_to_string(init_dir.join("migration.sql")).unwrap();
    assert!(
        sql.contains("UNIQUE KEY `idx_post_author` (`post`, `author`, `_live`)"),
        "{sql}"
    );

    write_app(
        tmp.path().join("tp/schema.ts"),
        "import { table, integer } from \"typedpress\";\nexport const likes = table({ post: integer() }).index([\"psot\"]);\n",
    )
    .unwrap();
    let (out, report) = checked(tmp.path());
    assert!(!out.status.success());
    let diagnostic = &report["diagnostics"][0];
    assert_eq!(
        diagnostic["message"], "`.index()` names `psot`, which is not a field of this kind",
        "{report}"
    );
    assert_eq!(diagnostic["help"], "did you mean `post`?");
}

#[test]
fn json_check_lists_each_index_with_its_reason() {
    let tmp = tempfile::tempdir().unwrap();
    copy_app(
        root().join("examples/pantry/typedpress.config.ts"),
        tmp.path().join("typedpress.config.ts"),
    )
    .unwrap();
    copy_app(
        root().join("examples/pantry/tp/lib/fields.ts"),
        tmp.path().join("tp/lib/fields.ts"),
    )
    .unwrap();
    let (out, report) = checked(tmp.path());
    assert!(out.status.success(), "{report}");
    let indexes = report["indexes"].as_array().expect("an indexes list");
    let find = |table: &str, name: &str| {
        indexes
            .iter()
            .find(|i| i["table"] == table && i["name"] == name)
            .unwrap_or_else(|| panic!("no index {table}.{name} in {indexes:?}"))
            .clone()
    };
    assert_eq!(find("items", "PRIMARY")["reason"], "primary key");
    assert_eq!(
        find("items", "slug_unique"),
        json!({ "table": "items", "name": "slug_unique", "unique": true, "columns": ["slug", "_live"], "reason": "`slug` is .unique()" })
    );
    assert_eq!(
        find("items", "tp_items_locationId_fk")["reason"],
        "`locationId` references locations: MySQL indexes a foreign key"
    );
    // Inferred (spec §2.9): a field a compiled `where` or `orderBy` names gets an index, unless one
    // already starts with it. pantry's hooks and actions filter and order items by both.
    assert_eq!(
        find("items", "expiresOn_queried"),
        json!({ "table": "items", "name": "expiresOn_queried", "unique": false, "columns": ["expiresOn"], "reason": "`expiresOn` is in a compiled `where` or `orderBy`" })
    );
    assert!(find("items", "quantity_queried")["reason"].as_str().is_some());
    // `shopping_list.itemId` (filtered, and `.unique()`) and `items.id` (filtered, the primary key)
    // already lead an index: no second one.
    assert!(
        !indexes
            .iter()
            .any(|i| i["name"] == "itemId_queried" || i["name"] == "id_queried"),
        "a field already leading an index gets no second one: {indexes:?}"
    );
    assert!(
        indexes
            .iter()
            .all(|i| i["reason"].as_str().is_some_and(|r| !r.is_empty())),
        "{indexes:?}"
    );
}

#[test]
fn nested_presentation_reaches_scf_and_public_schema_without_storage_migrations() {
    let tmp = tempfile::tempdir().unwrap();
    let config = r#"import { collection, defineConfig, text, group, repeater, blocks, json } from "typedpress";
const notes = collection({
  title: text(),
  seo: group({ summary: text().ui({ label: "Display name", help: "<b>Plain text</b>", placeholder: "Jane", width: 50 }).optional() }).ui({ label: "SEO" }).optional(),
  rows: repeater({ value: text().ui({ label: "Row value", help: undefined, placeholder: undefined, width: undefined }).optional() }).optional(),
  content: blocks({ hero: { heading: text().ui({ label: "Heading" }).optional() } }).optional(),
  metadata: json().optional(),
}, { title: "title" });
export { notes }; export default defineConfig({ name: "presentation" });"#;
    std::fs::write(tmp.path().join("typedpress.config.ts"), config).unwrap();
    let content = build_wp(tmp.path());
    let schema = content.join("plugins/typedpress-app-presentation/tp/app/schema.php");
    let got = php(
        r#"
        require $argv[1];
        $schema = \TypedPress\Schema::load($argv[2]);
        $columns = $schema->collection('notes')['columns'];
        $field = \TypedPress\Wp\Scf::fieldFor($schema, 'field_seo', 'tp_seo', 'seo', $columns['seo'], []);
        $json = \TypedPress\Wp\Scf::fieldFor($schema, 'field_metadata', 'tp_metadata', 'metadata', $columns['metadata'], []);
        echo json_encode(['columns' => $columns, 'public' => $schema->describe()['collections']['notes']['columns'], 'field' => $field, 'json' => $json]);
    "#,
        &[&content.join("plugins/typedpress-runtime/tp/bootstrap.php"), &schema],
    );
    let ui = json!({"label": "Display name", "help": "<b>Plain text</b>", "placeholder": "Jane", "width": 50});
    assert_eq!(got["columns"]["seo"]["fields"]["summary"]["ui"], ui);
    assert_eq!(got["public"]["seo"]["fields"]["summary"]["ui"], ui);
    assert_eq!(
        got["public"]["rows"]["fields"]["value"]["ui"],
        json!({"label": "Row value"})
    );
    assert_eq!(
        got["public"]["content"]["layouts"]["hero"]["heading"]["ui"]["label"],
        "Heading"
    );
    let field = &got["field"]["sub_fields"][0];
    assert_eq!(field["key"], "field_seo_summary");
    assert_eq!(field["name"], "summary");
    assert_eq!(field["label"], "Display name");
    assert_eq!(field["instructions"], "&lt;b&gt;Plain text&lt;/b&gt;");
    assert_eq!(field["placeholder"], "Jane");
    assert_eq!(field["wrapper"]["width"], 50);
    assert_eq!(got["json"]["instructions"], "Enter valid JSON.");
    let ledger = || -> Vec<(String, Vec<u8>)> {
        let mut out = Vec::new();
        for e in std::fs::read_dir(tmp.path().join("tp/_generated/migrations")).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                let name = p.file_name().unwrap().to_string_lossy().into_owned();
                out.push((name, std::fs::read(p.join("ops.json")).unwrap()));
            }
        }
        out.sort();
        out
    };
    let before = ledger();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        config.replace("width: 50", "width: 100"),
    )
    .unwrap();
    build_wp(tmp.path());
    assert_eq!(ledger(), before, "presentation changes cannot change storage");
    assert_eq!(ledger().len(), 1, "a presentation change planned a migration");
}

#[test]
fn malformed_ui_is_rejected_including_unknown_keys_nulls_and_fractional_widths() {
    for ui in [
        "null",
        "{ label: null }",
        "{ width: 2.5 }",
        "{ width: 0 }",
        "{ width: 256 }",
        "{ readOnly: true }",
        "{ help: () => 'effect' }",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!(
            "import {{ collection, text, defineConfig }} from 'typedpress'; const notes = collection({{ title: text().ui({ui}).optional() }}, {{ title: 'title' }}); export {{ notes }}; export default defineConfig({{}});"
        )).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{ui}: {report}");
        assert_eq!(report["diagnostics"][0]["code"], "F3101", "{ui}: {report}");
    }
}

#[test]
fn uri_vectors_agree_in_node_pure_evaluation_and_generated_php() {
    let values: Value = serde_json::from_str(include_str!("differential/uri-vectors.json")).unwrap();
    let node = Command::new("node").args(["--input-type=module", "-e",
        "const values = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify(values.map(v => [encodeURI(v), encodeURIComponent(v)])));"
    ]).arg(values.to_string()).output().unwrap();
    assert!(node.status.success());
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), format!(r#"
import {{ collection, text, json, defineConfig, mutation }} from "typedpress";
const values = {values};
const encoded = values.map(value => [encodeURI(value), encodeURIComponent(value)]);
const notes = collection({{ title: text(), result: json().default(encoded).optional() }}, {{ title: "title" }});
export {{ notes }}; const __encode = mutation({{}}, () => values.map(value => [encodeURI(value), encodeURIComponent(value)])); export {{ __encode as encode }}; export default defineConfig({{ name: "uri" }});
"#)).unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/typedpress-app-uri/tp/app");
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\TypedPressApp\\' . $schema['actions']['encode']['handler'];
        echo \TypedPress\Js::jsonStringify([\TypedPress\Js::decodeJson($schema['collections']['notes']['columns']['result']['default']['json']), $fn(new \TypedPress\JsObject(), \TypedPress\Seam::ctx(['user' => null]))]);
    "#,
        &[&content.join("plugins/typedpress-runtime/tp/bootstrap.php"), &app],
    );
    assert_eq!(result, json!([expected, expected]));
    let invalid = php(
        r#"
        require $argv[1];
        try { \TypedPress\Js::encodeURI("\xC0\xAF"); echo json_encode('accepted'); }
        catch (\TypedPress\JsError $e) { echo json_encode($e->jsName); }
    "#,
        &[&root().join("runtime/TypedPress/bootstrap.php")],
    );
    assert_eq!(invalid, "URIError");
}

#[test]
fn timers_run_only_while_the_request_waits_and_refuse_to_outlive_the_handler() {
    // A timer still pending when the handler returns would fire after the response in Node; the PHP
    // request ends first, so the runtime refuses at handler end and names the creation site.
    let tmp = tempfile::tempdir().unwrap();
    write_app(tmp.path().join("tp/timers.js"),
        "export function pending(){ setTimeout(() => {}, 5); return 1; }\nexport function cleared(){ const h = setTimeout(() => {}, 5); clearTimeout(h); AbortSignal.timeout(5); return 2; }\nexport function late(){ const h = setTimeout(() => {}, 'x'); return typeof h; }",
    )
    .unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress';import {pending,cleared,late} from './tp/timers.js';const __pending = mutation({}, ()=>pending()); export { __pending as pending }; const __cleared = mutation({}, ()=>cleared()); export { __cleared as cleared }; const __late = mutation({}, ()=>late()); export { __late as late }; export default defineConfig({ name:'timers' });").unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$s=require $argv[2].'/schema.php';require $argv[2].'/functions.php';
        $out=[];
        foreach (['pending','cleared','late'] as $a) {
            $fn='\\TypedPressApp\\'.$s['actions'][$a]['handler'];
            try { $out[]=['ok', \TypedPress\Timers::run(fn() => $fn(new \TypedPress\JsObject(), \TypedPress\Seam::ctx(['user'=>null])))]; }
            catch (\TypedPress\JsError $e) { $out[]=[$e->jsName, $e->getMessage()]; }
            $out[]=\TypedPress\Timers::pending();
        }
        echo json_encode($out);"#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-timers/tp/app"),
        ],
    );
    assert_eq!(
        result,
        json!([
            [
                "Error",
                "A setTimeout callback is still pending when the handler returns (timers.js:1:28); await it or clearTimeout it first"
            ],
            0,
            ["ok", 2],
            0,
            [
                "Error",
                "A setTimeout callback is still pending when the handler returns (timers.js:3:35); await it or clearTimeout it first"
            ],
            0
        ])
    );
    // runNext() advances a pinned clock instead of sleeping, runs exactly one callback in
    // (due, creation) order, and refuses waits past the request budget.
    let order = php(
        r#"require $argv[1];
        putenv('TP_NOW=1000'); putenv('TP_TIMER_BUDGET_MS=100');
        $log=[];
        \TypedPress\Timers::set(function() use (&$log) { $log[]='b'; }, 20);
        \TypedPress\Timers::set(function() use (&$log) { $log[]='a'; }, 10);
        \TypedPress\Timers::set(function() use (&$log) { $log[]='c'; }, 20);
        $signal = \TypedPress\JsAbortSignal::timeout(15);
        while (\TypedPress\Timers::runNext()) { $log[] = \TypedPress\Timers::clock(); }
        \TypedPress\Timers::set(function() {}, 500);
        try { \TypedPress\Timers::runNext(); $log[]='slept'; } catch (\TypedPress\JsError $e) { $log[]=$e->jsName; }
        // A throwing abort listener: dispatch continues (as in Node), then the error ends the
        // request where Node would report it as uncaught.
        $faulty = new \TypedPress\JsAbortController(); $seen = [];
        $faulty->signal->addEventListener('abort', function () use (&$seen) { $seen[] = 1; throw new \TypedPress\JsError('listener'); });
        $faulty->signal->addEventListener('abort', function () use (&$seen) { $seen[] = 2; });
        try { $faulty->abort(); } catch (\TypedPress\JsError $e) { $seen[] = $e->getMessage(); }
        echo json_encode([$log, $signal->aborted, $signal->reason->jsName, $seen]);"#,
        &[&root().join("runtime/TypedPress/bootstrap.php")],
    );
    assert_eq!(
        order,
        json!([
            ["a", 1010, 1015, "b", 1020, "c", 1020, "RangeError"],
            true,
            "TimeoutError",
            [1, 2, "listener"]
        ])
    );
}

#[test]
fn url_vectors_agree_in_node_and_generated_php() {
    // Every WHATWG urltestdata.json case (tests/differential/URL-WPT-NOTICE.txt) plus URLSearchParams
    // and setter cases, through checked JavaScript, compared with Node byte for byte.
    let dir = root().join("tests/differential");
    let wpt: Value = serde_json::from_str(include_str!("differential/url-wpt.json")).unwrap();
    let cases: Vec<Value> = wpt
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c.is_object())
        .map(|c| json!({ "input": c["input"], "base": c["base"] }))
        .collect();
    assert!(cases.len() > 800, "WPT subset shrank: {}", cases.len());
    let script = format!(
        "const m = await import({:?}); const cases = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify([m.parseAll(cases), m.searchParams(), m.invalid()]));",
        format!("file://{}", dir.join("url.js").display())
    );
    let node = Command::new("node")
        .args(["--input-type=module", "-e", &script])
        .arg(Value::Array(cases.clone()).to_string())
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let tmp = tempfile::tempdir().unwrap();
    copy_app(dir.join("url.js"), tmp.path().join("tp/url.js")).unwrap();
    std::fs::write(tmp.path().join("cases.json"), Value::Array(cases).to_string()).unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        r#"import { defineConfig, mutation } from "typedpress";
import { parseAll, searchParams, invalid } from "./tp/url.js";
const __probe = mutation({}, () => [searchParams(), invalid()]); export { __probe as probe }; export default defineConfig({ name: "url" });
"#,
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/typedpress-app-url/tp/app");
    // parseAll takes a data argument the action input can't carry at this size; call the compiled
    // module function directly with the decoded cases.
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\TypedPressApp\\' . $schema['actions']['probe']['handler'];
        $probe = $fn(new \TypedPress\JsObject(), \TypedPress\Seam::ctx(['user' => null]));
        $cases = \TypedPress\Js::decodeJson(file_get_contents($argv[3]));
        $parse = static function ($cases) {
            $props = ['href', 'origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'];
            $out = [];
            foreach ($cases->a as $c) {
                $base = \TypedPress\Js::dynamicGet($c, 'base');
                $parsed = \TypedPress\Js::dynamicStaticCall('URL', 'parse', new \TypedPress\JsArray($base === null ? [\TypedPress\Js::dynamicGet($c, 'input')] : [\TypedPress\Js::dynamicGet($c, 'input'), $base]));
                $out[] = $parsed === null ? null : new \TypedPress\JsArray(array_map(static fn ($p) => \TypedPress\Js::dynamicGet($parsed, $p), $props));
            }
            return new \TypedPress\JsArray($out);
        };
        echo \TypedPress\Js::jsonStringify(new \TypedPress\JsArray([$parse($cases), ...$probe->a]));
    "#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &app,
            &tmp.path().join("cases.json"),
        ],
    );
    // URL parsing is checked against WPT's own expected values: Node lags the URL Standard on a
    // few newer cases, which the bundled parser already implements. Node remains the oracle for
    // the URLSearchParams and setter vectors, which WPT's urltestdata doesn't cover.
    let props = [
        "href", "origin", "protocol", "username", "password", "host", "hostname", "port", "pathname", "search", "hash",
    ];
    let mut node_lags = 0;
    let cases_wpt: Vec<&Value> = wpt.as_array().unwrap().iter().filter(|c| c.is_object()).collect();
    for (i, (case, (have, node))) in cases_wpt
        .iter()
        .zip(
            result[0]
                .as_array()
                .unwrap()
                .iter()
                .zip(expected[0].as_array().unwrap()),
        )
        .enumerate()
    {
        let want = if case["failure"] == true {
            Value::Null
        } else {
            Value::Array(
                props
                    .iter()
                    .map(|p| match case.get(*p) {
                        Some(v) => v.clone(),
                        // origin is absent from a few cases; compare what Node computes there.
                        None => node[props.iter().position(|q| q == p).unwrap()].clone(),
                    })
                    .collect(),
            )
        };
        assert_eq!(have, &want, "WPT urltestdata case {i}: {}", case["input"]);
        node_lags += usize::from(node != &want);
    }
    // Node 22 fails 7 newer cases (trailing spaces in opaque paths, `^` in paths); more means drift.
    assert!(node_lags <= 7, "Node disagrees with WPT on {node_lags} cases");
    assert_eq!(
        result[1], expected[1],
        "URLSearchParams and setter vectors differ from Node"
    );
    assert_eq!(result[2], expected[2], "invalid URLs differ from Node");
}

#[test]
fn syntax_and_environment_failures_also_produce_a_complete_json_envelope() {
    let tmp = tempfile::tempdir().unwrap();
    let (out, missing) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(missing["diagnostics"][0]["code"], "F1003");
    assert_eq!(missing["diagnostics"][0]["location"], Value::Null);
    let relocated = tempfile::tempdir().unwrap();
    let (out, relocated_missing) = checked(relocated.path());
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(missing["groups"][0]["id"], relocated_missing["groups"][0]["id"]);
    for (report, project) in [(&missing, tmp.path()), (&relocated_missing, relocated.path())] {
        assert!(
            report["diagnostics"][0]["message"]
                .as_str()
                .unwrap()
                .contains(project.to_str().unwrap())
        );
    }
    std::fs::write(tmp.path().join("typedpress.config.ts"), "const x = ;").unwrap();
    let (out, syntax) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(syntax["diagnostics"][0]["code"], "F1001");
}

#[test]
fn node_oracle_refuses_an_empty_selection_instead_of_reporting_success() {
    let tmp = tempfile::tempdir().unwrap();
    let config = tmp.path().join("empty.ts");
    std::fs::write(&config, "export default { actions: {} };").unwrap();
    let out = Command::new("node")
        .arg(root().join("tests/differential/run-node.mjs"))
        .arg(config)
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("oracle executed no cases"));
}

/// A tagged template's cooked string with a lone UTF-16 surrogate can't be stored as UTF-8, so the
/// strings array is refused, except under `String.raw`, which reads only the raw source text.
#[test]
fn tagged_templates_refuse_lone_surrogates_except_under_string_raw() {
    for (handler, compiles) in [
        (r"() => String.raw`a\uD800b`", true),
        (
            r"() => { const t = (s: TemplateStringsArray) => s.raw[0]; return t`a\uD800b`; }",
            false,
        ),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("typedpress.config.ts"),
            format!(
                r#"
import {{ collection, text, defineConfig, mutation }} from "typedpress";
const notes = collection({{ title: text() }}, {{ title: "title" }});
const __raw = mutation({{}}, {handler});
export {{ notes, __raw as raw }}; export default defineConfig({{}});
"#
            ),
        )
        .unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.success(), compiles, "{handler}: {report}");
        if !compiles {
            assert!(
                report["diagnostics"][0]["message"]
                    .as_str()
                    .unwrap()
                    .contains("lone UTF-16 surrogates"),
                "{handler}: {report}"
            );
        }
    }
}

#[test]
fn uri_encoding_refuses_coercion_and_discarded_arguments() {
    for expression in [
        "encodeURI(42)",
        "encodeURIComponent()",
        "encodeURI('a', 'b')",
        r"encodeURI('\uD800')",
    ] {
        for handler in [false, true] {
            let tmp = tempfile::tempdir().unwrap();
            let invocation = if handler {
                format!("() => {expression}")
            } else {
                expression.to_string()
            };
            std::fs::write(tmp.path().join("typedpress.config.ts"), format!(r#"
import {{ collection, text, defineConfig, mutation }} from "typedpress";
const result = {invocation};
const notes = collection({{ title: text() }}, {{ title: "title" }});
export {{ notes }}; const __encode = mutation({{}}, {handler_body}); export {{ __encode as encode }}; export default defineConfig({{}});
"#, handler_body = if handler { "result".to_string() } else { "() => result".to_string() })).unwrap();
            let (out, report) = checked(tmp.path());
            assert_eq!(out.status.code(), Some(1), "{expression}: {report}");
            assert_eq!(report["ok"], false);
            assert!(!tmp.path().join(".tp").exists());
        }
    }
}

#[test]
fn type_guards_validate_their_domains_and_boolean_returns() {
    for (helper, message) in [
        (
            "function guard(value: string): absent is string { return true; }",
            "must name one plain function parameter",
        ),
        (
            "function guard(value: number): value is string { return true; }",
            "must be assignable to parameter",
        ),
        (
            "function guard(value: undefined): value is null { return true; }",
            "must be assignable to parameter",
        ),
        (
            "async function guard(value: string): value is string { return true; }",
            "must be synchronous",
        ),
        (
            "function guard(value: string): value is string { return 1; }",
            "boolean",
        ),
        (
            "function guard(value: unknown) { if (typeof value === 'number') return true; return value.trim() !== ''; }",
            "unknown",
        ),
        ("function guard(value: unknown) { return value + 1; }", "ambiguous"),
        (
            "function guard(value: unknown, text: string | null) { return value + text; }",
            "ambiguous",
        ),
        (
            "function guard(value: unknown, texts: (string | null)[]) { return value + texts[0]; }",
            "ambiguous",
        ),
        (
            "function guard(value: unknown, numbers: number[]) { return value + numbers[0]; }",
            "ambiguous",
        ),
        (
            "function guard(value: unknown, texts: string[]) { return (value + texts[0]).length; }",
            "has no property",
        ),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("typedpress.config.ts"),
            format!(
                r#"
import {{ defineConfig, mutation }} from "typedpress";
{helper}
const __probe = mutation({{}}, () => guard); export {{ __probe as probe }}; export default defineConfig({{}});
"#
            ),
        )
        .unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{helper}: {report}");
        assert!(
            report["diagnostics"]
                .as_array()
                .unwrap()
                .iter()
                .any(|diagnostic| { diagnostic["message"].as_str().unwrap().contains(message) }),
            "{helper}: {report}"
        );
    }
}

#[test]
fn unannotated_javascript_uses_checked_value_operations_without_weakening_typescript_unknown() {
    let tmp = tempfile::tempdir().unwrap();
    let helper = r#"
export function combine(left, right) { return left + right; }
export function read(value) { return value.trim(); }
const missing = undefined;
const nested = { missing: undefined };
export function absent() {}
export function missingKinds() { let empty; return [typeof missing, typeof nested.missing, typeof empty, empty === undefined, empty === null]; }
export function errorEffects() {
  let count = 0;
  const plain = Error(undefined, count++);
  const constructed = new TypeError(undefined, count++);
  try { throw new RangeError(undefined, count++); }
  catch (error) { return [plain.message, constructed.message, error.message, count]; }
}
export function replaceCount(value) { value.count = 'x'; }
export function replaceCopiedSlot(value) {
  const copied = [].slice.call([value]);
  copied[0] = { count: 'copy' };
  copied.push({ count: 'extra' });
}
export function methodOrder() {
  const object = { method: () => 1 };
  function narrowed(value) {
    if (typeof value === 'string') return value.replace(/^\//, '').replaceAll(/\/$/g, '');
    return '';
  }
  function borrowed(first, middle, last) {
    const slice = [].slice;
    const selected = slice.call(arguments, 1, -1);
    const empty = slice.call(arguments, 0, null);
    const copied = slice.apply(arguments, [0, undefined]);
    copied.push('copy');
    return { selected, empty, copied, array: slice.call([first, middle, last], 1, -1), original: Array.from(arguments), identity: slice === [].slice };
  }
  return { order: object.method(object.method = () => 2), computed: ['one', 'two']['join'](':'), narrowed: narrowed('/value/'), borrowed: borrowed('first', 'middle', 'last') };
}
export function objects(value) {
  const holder = {};
  holder.value = value;
  holder.value.count += 1;
  return holder.value;
}
"#;
    write_app(tmp.path().join("tp/helpers.mjs"), helper).unwrap();
    let mutation = r#"
function mutation() { const object = { count: 1 }; replaceCount(object); return object.count + 1; }
function copiedSlots(): number { const object = { count: 1 }; replaceCopiedSlot(object); return object.count + 1; }
function discardRest(...values: string[][]) { values.pop(); }
function optionalObject(value?: { count: number }) { return value ? value.count : 'absent'; }
function optionalArray(value?: string[]) { return value ? value.length : -1; }
function optionalString(value?: string) { return value ? value.trim() : 'absent'; }
function defaultArray(value: string[] = ['default']) { return value.length; }
function addressPatch(patch: { address?: { city: string } | null }) {
  let touched = false;
  let city = 'absent';
  if (patch.address !== undefined) { touched = true; city = patch.address?.city ?? 'null'; }
  return [touched, city];
}
function strictNull(value?: { count: number } | null) { return value !== null ? value?.count ?? 'undefined' : 'null'; }
function strictUndefined(value?: { count: number } | null) { return value !== undefined ? value?.count ?? 'null' : 'undefined'; }
function strictNullArray(value?: string[]) { return value !== null ? value?.length ?? -1 : -2; }
function nullishValues() {
  const object: { count: number } | null | undefined = undefined;
  const array: string[] | null | undefined = undefined;
  const text: string | null | undefined = undefined;
  return [optionalObject(undefined), optionalArray(undefined), optionalString(undefined), defaultArray(undefined), Boolean(object), Boolean(array), Boolean(text), addressPatch({}), addressPatch({ address: null }), addressPatch({ address: { city: 'Oslo' } }), strictNull(undefined), strictNull(null), strictUndefined(undefined), strictUndefined(null), strictNullArray(undefined)];
}
function nonempty() {
  let values = Array.from(['first']);
  values.reduce((all, value) => all.concat(value), ['start'].slice());
  const pattern = new RegExp('first', 'g');
  values = values.map(value => value.replace(pattern, 'second'));
  discardRest(values);
  return values[0];
}
"#;
    let expression = r#"({ nullish: nullishValues(), mutation: mutation(), copiedSlots: copiedSlots(), nonempty: nonempty(), method: methodOrder(), errors: errorEffects(), missingKinds: missingKinds(), number: combine(2, 3), string: combine('2', 3), missing: typeof absent(), object: objects({ count: 1 }), trimmed: read('  text  ') })"#;
    let node = Command::new("node")
        .current_dir(tmp.path())
        .args(["--input-type=module-typescript", "-e", &format!("import {{combine, read, absent, objects, replaceCount, replaceCopiedSlot, methodOrder, missingKinds, errorEffects}} from './tp/helpers.mjs'; {mutation} process.stdout.write(JSON.stringify({expression}));")])
        .output().unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), format!(r#"
import {{ defineConfig, mutation as server }} from 'typedpress';
import {{ combine, read, absent, objects, replaceCount, replaceCopiedSlot, methodOrder, missingKinds, errorEffects }} from './tp/helpers.mjs';
{mutation}
function nullable(value: string | null) {{ return value.trim(); }}
const __probe = server({{}}, () => {expression}); export {{ __probe as probe }}; const __dynamicError = server({{}}, () => {{ try {{ read(2); return false; }} catch {{ return true; }} }}); export {{ __dynamicError as dynamicError }}; const __nullableError = server({{}}, () => {{ try {{ nullable(null); return false; }} catch {{ return true; }} }}); export {{ __nullableError as nullableError }}; export default defineConfig({{ name: 'js-values' }});
"#)).unwrap();
    let content = build_wp(tmp.path());
    let actual = php(
        r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$result = [];
foreach (['probe', 'dynamicError', 'nullableError'] as $key) {
  $fn = '\\TypedPressApp\\' . $schema['actions'][$key]['handler'];
  $result[] = $fn(new \TypedPress\JsObject(), new \TypedPress\JsObject());
}
echo \TypedPress\Js::jsonStringify($result);
"#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-js-values/tp/app"),
        ],
    );
    assert_eq!(actual, json!([expected, true, true]));

    // The nonempty proof belongs to the container and must disappear through aliases.
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        r#"
import { defineConfig, mutation } from 'typedpress';
const __probe = mutation({}, (): string => {
  const values = Array.from(['first']);
  const alias = values;
  alias.pop();
  return values[0];
}); export { __probe as probe }; export default defineConfig({});
"#,
    )
    .unwrap();
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1), "{report}");
    assert!(
        report["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|diagnostic| diagnostic["message"].as_str().unwrap().contains("string | undefined")),
        "{report}"
    );

    // Borrowed mutators cannot bypass a typed caller's array element domain.
    write_app(
        tmp.path().join("tp/helpers.mjs"),
        "export function change(values) { const push = [].push; push.call(values, 'x'); }",
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        r#"
import { defineConfig, mutation } from 'typedpress';
import { change } from './tp/helpers.mjs';
const __probe = mutation({}, (): number => {
  const values: number[] = [1];
  change(values);
  return values.reduce((sum, value) => sum + value, 0);
}); export { __probe as probe }; export default defineConfig({});
"#,
    )
    .unwrap();
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1), "{report}");
    assert!(
        report["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|diagnostic| diagnostic["message"].as_str().unwrap().contains("push")),
        "{report}"
    );

    for (parameters, copied, field, argument) in [
        ("values", "values.slice()", "[0].count", "values"),
        ("values", "[].slice.call(values)", "[0].count", "values"),
        ("values", "[].slice[method](values, [])", "[0].count", "values"),
        ("", "[].slice.call(arguments)", "[0].count", "values[0]"),
        ("values", "[].slice.call(values)", "[0][0].count", "[values]"),
        ("", "[].slice.call(arguments)", "[0].count", "...values"),
        ("first, value", "[].slice.call([value])", "[0].count", "...values"),
    ] {
        write_app(tmp.path().join("tp/helpers.mjs"),
            format!("function mutate({parameters}) {{ const method = 'apply'; const copied = {copied}; copied{field} = 'x'; }} export function change(values) {{ mutate({argument}); }}"),
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("typedpress.config.ts"),
            r#"
import { defineConfig, mutation } from 'typedpress';
import { change } from './tp/helpers.mjs';
const __probe = mutation({}, (): number => {
  const object = { count: 1 };
  const values = [object, object];
  change(values);
  return object.count + 1;
}); export { __probe as probe }; export default defineConfig({});
"#,
        )
        .unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{copied}: {report}");
        assert!(
            report["diagnostics"]
                .as_array()
                .unwrap()
                .iter()
                .any(|diagnostic| diagnostic["message"].as_str().unwrap().contains("JavaScript value")),
            "{copied}: {report}"
        );
    }
}

/// Byte values from imported JavaScript: every exported case of tests/differential/binary.mjs runs
/// under Node and as compiled PHP, including files-sdk's own MD5 code and Blob reads and streams.
#[test]
fn binary_data_matches_node_through_generated_php() {
    let tmp = tempfile::tempdir().unwrap();
    for file in ["binary.mjs", "files-sdk-md5.mjs"] {
        copy_app(
            root().join("tests/differential").join(file),
            tmp.path().join("tp").join(file),
        )
        .unwrap();
    }
    let node = Command::new("node")
        .current_dir(tmp.path())
        .args([
            "--input-type=module",
            "-e",
            "import * as cases from './tp/binary.mjs'; const out = {}; for (const [name, run] of Object.entries(cases)) out[name] = await run(); process.stdout.write(JSON.stringify(out));",
        ])
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let names: Vec<&String> = expected.as_object().unwrap().keys().collect();
    assert!(names.len() >= 14, "{expected}");
    let actions: Vec<String> = names
        .iter()
        .map(|name| format!("export const {name} = mutation({{}}, async () => await cases.{name}());"))
        .collect();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        format!(
            "import {{ defineConfig, mutation }} from 'typedpress';\nimport * as cases from './tp/binary.mjs';\n{}\nexport default defineConfig({{ name: 'binary-tests' }});\n",
            actions.join("\n")
        ),
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let actual = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $out = [];
        foreach ($schema['actions'] as $name => $action) {
            $fn = '\\TypedPressApp\\' . $action['handler'];
            try { $out[$name] = $fn(new \TypedPress\JsObject(), new \TypedPress\JsObject()); }
            catch (\Throwable $e) { $out[$name] = get_class($e) . ': ' . $e->getMessage(); }
        }
        echo \TypedPress\Js::jsonStringify(new \TypedPress\JsObject($out));
    "#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-binary-tests/tp/app"),
        ],
    );
    for name in &names {
        assert_eq!(
            actual[name.as_str()],
            expected[name.as_str()],
            "{name}: compiled byte behavior differs from Node"
        );
    }
    // JSON has no byte type: an action result holding bytes is refused, with the text fix.
    let refused = php(
        r#"
        require $argv[1];
        $bytes = \TypedPress\JsTypedArray::fromBytes('ab');
        try { \TypedPress\JsBinary::refuseWire(new \TypedPress\JsObject(['v' => new \TypedPress\JsArray([$bytes])]), 'action a'); echo 'null'; }
        catch (\TypedPress\JsError $e) { echo json_encode([$e->jsName, $e->getMessage()]); }
    "#,
        &[&content.join("plugins/typedpress-runtime/tp/bootstrap.php")],
    );
    assert_eq!(refused[0], "TypeError");
    let message = refused[1].as_str().unwrap();
    assert!(
        message.contains("Uint8Array at .v.0") && message.contains("TextDecoder"),
        "{message}"
    );
}

#[test]
fn binary_globals_refuse_shared_memory_and_typed_code_with_fixes() {
    for (file, source, message, fix) in [
        (
            "helper.mjs",
            "export function make(){ return new SharedArrayBuffer(4); }",
            "`SharedArrayBuffer` isn't supported",
            "use ArrayBuffer",
        ),
        (
            "helper.mjs",
            "export function make(){ return new BigUint64Array(1); }",
            "`BigUint64Array` isn't supported",
            "DataView",
        ),
        (
            "helper.mjs",
            "export function make(){ return Uint8Array(2); }",
            "`Uint8Array` must be called with `new`",
            "new Uint8Array",
        ),
        (
            "helper.mjs",
            "const made = new TextEncoder(() => 1); export function make(){ return made; }",
            "module-scope `TextEncoder` arguments must be plain data",
            "inside the function",
        ),
        (
            "helper.mjs",
            "const holder = { values: Uint8Array.of(1) }; export function make(){ return holder; }",
            "exists only while the config is built",
            "call or read its members directly",
        ),
        (
            "helper.ts",
            "export function make(): number { return new Uint8Array(2).length; }",
            "`Uint8Array` is only available in imported JavaScript so far",
            "pass text across",
        ),
        (
            "helper.ts",
            "export function make(): string { return btoa(\"x\"); }",
            "`btoa` is only available in imported JavaScript so far",
            "JavaScript or npm helper",
        ),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        write_app(tmp.path().join("tp").join(file), source).unwrap();
        std::fs::write(
            tmp.path().join("typedpress.config.ts"),
            format!("import {{ defineConfig, mutation }} from 'typedpress';\nimport {{ make }} from './tp/{file}';\nconst __probe = mutation({{}}, () => {{ make(); return 1; }}); export {{ __probe as probe }}; export default defineConfig({{}});\n"),
        )
        .unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{source}: {report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(
            diagnostic["message"].as_str().unwrap().contains(message),
            "{source}: {report}"
        );
        assert!(diagnostic["location"].is_object(), "{report}");
        assert!(diagnostic["help"].as_str().unwrap().contains(fix), "{source}: {report}");
    }
}

#[test]
fn promise_jobs_generators_and_async_iteration_match_node_in_generated_php() {
    // Job order is observable in JavaScript: every log must match Node exactly.
    let cases = [
        "interleaving",
        "adoption",
        "combinators",
        "lateHandling",
        "generators",
        "pagination",
        "streams",
        "failures",
    ];
    let tmp = tempfile::tempdir().unwrap();
    copy_app(
        root().join("tests/differential/async.mjs"),
        tmp.path().join("tp/async.mjs"),
    )
    .unwrap();
    let script = format!(
        "import * as m from './tp/async.mjs'; const out = []; for (const name of {cases:?}) out.push(await m[name]()); await new Promise((r) => setTimeout(r, 0)); process.stdout.write(JSON.stringify(out));"
    );
    let node = Command::new("node")
        .current_dir(tmp.path())
        .args(["--input-type=module", "-e", &script])
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let actions = cases
        .iter()
        .map(|name| format!("export const {name} = mutation({{}}, async () => await cases.{name}());"))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        format!(
            "import {{ defineConfig, mutation }} from 'typedpress';\nimport * as cases from './tp/async.mjs';\n{actions}\nexport default defineConfig({{ name: 'async-diff' }});\n"
        ),
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let actual = php(
        &format!(
            r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$result = [];
foreach ({} as $key) {{
  $fn = '\\TypedPressApp\\' . $schema['actions'][$key]['handler'];
  $result[] = $fn(new \TypedPress\JsObject(), new \TypedPress\JsObject());
}}
echo \TypedPress\Js::jsonStringify(new \TypedPress\JsArray($result));
"#,
            serde_json::to_string(&cases).unwrap()
        ),
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-async-diff/tp/app"),
        ],
    );
    assert_eq!(actual, expected);

    // Handler end: an unhandled rejection and a promise nothing can settle are runtime errors.
    write_app(tmp.path().join("tp/async.mjs"),
        "export async function lost() { Promise.reject(new Error('lost')); return 1; }\nexport async function stuck() { await new Promise(() => {}); }\n",
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        "import { defineConfig, mutation } from 'typedpress';\nimport * as cases from './tp/async.mjs';\nexport const lost = mutation({}, async () => await cases.lost());\nexport const stuck = mutation({}, async () => await cases.stuck());\nexport default defineConfig({ name: 'async-diff' });\n",
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let errors = php(
        r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$result = [];
foreach (['lost', 'stuck'] as $key) {
  $fn = '\\TypedPressApp\\' . $schema['actions'][$key]['handler'];
  try { $fn(new \TypedPress\JsObject(), new \TypedPress\JsObject()); $result[] = 'completed'; }
  catch (\TypedPress\JsError $e) { $result[] = $e->getMessage(); }
}
echo json_encode($result);
"#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-async-diff/tp/app"),
        ],
    );
    assert_eq!(
        errors,
        json!([
            "lost",
            "This promise can never settle: nothing left to run (awaited at typedpress.config.ts:4:47)"
        ])
    );
}

#[test]
fn documented_runtime_differences_are_measured_in_evaluation_and_compiled_php() {
    let expression = r#"[{ omitted: undefined, nested: { omitted: undefined, keep: 1 }, slots: [undefined] }, typeof undefined, typeof null, "🙂a".slice(2), "🙂".length, "🙂a"[2], "x🙂".split("", 1), [1, 2].includes(1, 1), [1, 2, 1].indexOf(1, -1), typeof [][0]]"#;
    let node = Command::new("node")
        .args(["-e", &format!("process.stdout.write(JSON.stringify({expression}));")])
        .output()
        .unwrap();
    assert!(node.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&node.stdout).unwrap(),
        json!([{"nested":{"keep":1},"slots":[null]}, "undefined", "object", "a", 2, "a", ["x"], false, 2, "undefined"])
    );
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), format!(r#"
import {{ collection, text, json, defineConfig, mutation }} from "typedpress";
const measured = {expression};
const notes = collection({{ title: text(), result: json().default(measured).optional() }}, {{ title: "title" }});
export {{ notes }}; const __measure = mutation({{}}, () => {expression}); export {{ __measure as measure }}; export default defineConfig({{ name: "differences" }});
"#)).unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\TypedPressApp\\' . $schema['actions']['measure']['handler'];
        echo \TypedPress\Js::jsonStringify([\TypedPress\Js::decodeJson($schema['collections']['notes']['columns']['result']['default']['json']), $fn(new \TypedPress\JsObject(), \TypedPress\Seam::ctx(['user' => null]))]);
    "#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-differences/tp/app"),
        ],
    );
    assert_eq!(
        result,
        json!([
            [{"nested":{"keep":1},"slots":[null]}, "undefined", "object", "a", 2, "a", ["x"], false, 2, "undefined"],
            [{"nested":{"keep":1},"slots":[null]}, "undefined", "object", "a", 2, "a", ["x"], false, 2, "undefined"]
        ])
    );
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        r#"const half = "🙂a".slice(1);"#,
    )
    .unwrap();
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1));
    assert!(
        report["diagnostics"].as_array().unwrap().iter().any(|d| {
            d["message"].as_str().unwrap().contains("a lone UTF-16 surrogate")
                && d["help"]
                    .as_str()
                    .is_some_and(|fix| fix.contains("character boundaries"))
        }),
        "{report}"
    );
}

#[test]
fn static_commonjs_packages_match_node_through_generated_php() {
    // picomatch's shapes: relative and package `require`, destructured `require`,
    // `exports.x =` read back through `exports`, `module.exports = { … }`, a
    // function export with named exports for ESM importers, and evaluation order.
    let tmp = tempfile::tempdir().unwrap();
    let files: &[(&str, &str)] = &[
        (
            "node_modules/glob-lite/package.json",
            r#"{"name":"glob-lite","main":"index.js"}"#,
        ),
        (
            "node_modules/glob-lite/index.js",
            "'use strict';\nconst { log, add, isModule } = require('./lib/log');\nadd(isModule ? 'index' : 'wrong-this');\nconst escape = require('./lib/escape');\nconst { STAR } = require('./lib/constants');\nlog.push('after');\nfunction toSource(glob) { return glob.split(STAR).map(escape).join('[^/]*'); }\nmodule.exports = toSource;\n",
        ),
        (
            "node_modules/glob-lite/lib/log.js",
            "var __add = (this && this.__add) || function (list, entry) { list.push(entry); };\nexports.log = [];\nexports.add = (entry) => __add(exports.log, entry);\nexports.isModule = this === module.exports;\n",
        ),
        (
            "node_modules/glob-lite/lib/constants.js",
            "require('./log').log.push('constants');\nmodule.exports = { STAR: '*', SPECIAL: /[.+?^${}()|[\\]\\\\]/g };\n",
        ),
        (
            "node_modules/glob-lite/lib/escape.js",
            "const { SPECIAL } = require('./constants');\nrequire('./log').log.push('escape');\nexports.escape = (part) => part.replace(SPECIAL, '\\\\$&');\nmodule.exports = exports.escape;\n",
        ),
        (
            "node_modules/counts/package.json",
            r#"{"name":"counts","exports":{".":{"require":"./counts.cjs","import":"./missing.mjs"}}}"#,
        ),
        (
            "node_modules/counts/counts.cjs",
            "exports.limit = 3;\nexports.label = 'items';\n",
        ),
        (
            "tp/probe.cjs",
            "const toSource = require('glob-lite');\nconst { log } = require('glob-lite/lib/log');\nconst { limit, label } = require('counts');\nfunction run(glob) { return { source: toSource(glob), order: log.join(','), limit, label }; }\nmodule.exports = run;\n",
        ),
    ];
    for (path, source) in files {
        let path = tmp.path().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, source).unwrap();
    }
    std::fs::write(
        tmp.path().join("node.cjs"),
        "process.stdout.write(JSON.stringify(require('./tp/probe.cjs')('src/*.test.js')));",
    )
    .unwrap();
    let node = Command::new("node").arg(tmp.path().join("node.cjs")).output().unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(
        expected,
        json!({"source": "src/[^/]*\\.test\\.js", "order": "index,constants,escape,after", "limit": 3, "label": "items"})
    );
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        r#"
import { defineConfig, text, mutation } from "typedpress";
import run from "./tp/probe.cjs";
const __probe = mutation({ access: "anyone" }, (input: { glob: string }) => run(input.glob)); export { __probe as probe }; export default defineConfig({ name: "commonjs" });
"#,
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\TypedPressApp\\' . $schema['actions']['probe']['handler'];
        echo \TypedPress\Js::jsonStringify($fn(new \TypedPress\JsObject(['glob' => 'src/*.test.js']), \TypedPress\Seam::ctx(['user' => null])));
    "#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-commonjs/tp/app"),
        ],
    );
    assert_eq!(result, expected);
}

#[test]
fn classes_match_node_through_generated_php_and_wire_client_types() {
    let tmp = tempfile::tempdir().unwrap();
    let config = root().join("tests/differential/classes.ts");
    std::fs::copy(&config, tmp.path().join("typedpress.config.ts")).unwrap();
    let js = tmp.path().join("node");
    let transpiled = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .args(["--noCheck", "--target", "ES2022", "--module", "ESNext", "--outDir"])
        .arg(&js)
        .arg(config)
        .output()
        .unwrap();
    assert!(
        transpiled.status.success(),
        "{}{}",
        String::from_utf8_lossy(&transpiled.stdout),
        String::from_utf8_lossy(&transpiled.stderr)
    );
    let node = Command::new("node")
        .arg(root().join("tests/differential/run-node.mjs"))
        .arg(js.join("classes.js"))
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(expected["complete"], true);
    let cases = expected["cases"].as_object().unwrap();
    assert_eq!(cases.len(), 5);
    assert!(cases.values().all(|result| result.get("data").is_some()), "{expected}");
    let content = build_wp(tmp.path());
    let runtime = content.join("plugins/typedpress-runtime/tp/bootstrap.php");
    let app = content.join("plugins/typedpress-app-class-tests/tp/app");
    let actual = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $out = [];
        foreach ($schema['actions'] as $name => $action) {
            $fn = '\\TypedPressApp\\' . $action['handler'];
            try { $out[$name] = ['data' => $fn()]; }
            catch (\Throwable $e) { $out[$name] = ['error' => $e->getMessage()]; }
        }
        echo \TypedPress\Js::jsonStringify($out);
    "#,
        &[&runtime, &app],
    );
    assert_eq!(actual, expected["cases"], "compiled class behavior differs from Node");
    // The schema seam drops class identity and detaches fields, without traversing descriptors.
    let seam = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\TypedPressApp\\' . $schema['actions']['classesWire']['handler'];
        $instance = $fn();
        $stored = \TypedPress\Seam::toPhp($instance, ['type' => 'json']);
        $input = \TypedPress\Seam::toJs($stored, ['type' => 'json']);
        $stored->p['count'] = 99;
        echo \TypedPress\Js::jsonStringify([
            'wire' => \TypedPress\Seam::toWire($instance),
            'identity' => [$instance->class !== null, $stored->class === null, $input->class === null],
            'detached' => [$instance->p['count'], $stored->p['count'], $input->p['count']],
        ]);
    "#,
        &[&runtime, &app],
    );
    assert_eq!(seam["wire"], expected["cases"]["classesWire"]["data"]);
    assert_eq!(seam["identity"], json!([true, true, true]));
    assert_eq!(seam["detached"], json!([5, 99, 5]));
    std::fs::write(
        tmp.path().join("class-client.ts"),
        r#"
import type { Actions } from './tp/_generated/client/types';
declare const instance: Actions['classesWire']['output'];
const count: number = instance.count;
const label: string = instance.label;
declare const derived: Actions['classesMutation']['output']['c'];
const inherited: string = derived.label;
const overridden: number = derived.count;
const extra: number = derived.extra;
declare const baseCall: Actions['classesBaseArgument']['output'];
const virtualResult: number = baseCall;
// @ts-expect-error Methods are not restored by JSON.
instance.inc(1);
declare const effects: Actions['classesEffects']['output'];
const changed: number = effects.count;
// @ts-expect-error A method mutation widens the numeric literal read.
const literal: 0 | 1 = effects.count;
// @ts-expect-error The class method clears the narrowed value.
const narrowed: { n: number } = effects.maybe;
// @ts-expect-error A virtual override clears the helper's argument.
const virtual: { n: number } = effects.virtual;
// @ts-expect-error Static updates widen literal reads.
const staticLiteral: 0 | 1 = effects.staticCount;
// @ts-expect-error Static object fields share captured module data.
const sharedLiteral: 0 | 1 = effects.sharedCount;
"#,
    )
    .unwrap();
    let types = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .args([
            "--strict",
            "--noEmit",
            "--target",
            "ES2022",
            "--module",
            "ESNext",
            "--moduleResolution",
            "bundler",
        ])
        .arg(tmp.path().join("class-client.ts"))
        .output()
        .unwrap();
    assert!(
        types.status.success(),
        "{}{}",
        String::from_utf8_lossy(&types.stdout),
        String::from_utf8_lossy(&types.stderr)
    );
}

#[test]
fn private_names_accessors_and_imported_javascript_classes_match_node() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = root().join("tests/differential");
    project_from(
        tmp.path(),
        &dir.join("class-private.ts"),
        &[&dir.join("class-private-lib.mjs")],
    );
    let node = Command::new("node")
        .arg(dir.join("run-node.mjs"))
        .arg(dir.join("class-private.ts"))
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(expected["complete"], true);
    assert_eq!(expected["cases"].as_object().unwrap().len(), 8);
    assert!(
        expected["cases"]
            .as_object()
            .unwrap()
            .values()
            .all(|r| r.get("data").is_some()),
        "{expected}"
    );
    let content = build_wp(tmp.path());
    let actual = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $out = [];
        foreach ($schema['actions'] as $name => $action) {
            $fn = '\\TypedPressApp\\' . $action['handler'];
            try { $out[$name] = ['data' => $fn()]; }
            catch (\Throwable $e) { $out[$name] = ['error' => $e->getMessage()]; }
        }
        echo \TypedPress\Js::jsonStringify($out);
    "#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-class-private/tp/app"),
        ],
    );
    assert_eq!(
        actual, expected["cases"],
        "private names or JavaScript classes differ from Node"
    );
}

#[test]
fn class_boundaries_refuse_unsupported_semantics_at_the_source() {
    for (declarations, handler, message) in [
        (
            "class C { constructor(x: number|null) {} }",
            "new C() instanceof C",
            "wrong number of class arguments",
        ),
        (
            "class C { read(x: number|null) {return x;} }",
            "new C().read()",
            "wrong number of class arguments",
        ),
        (
            "class C { static read(x: number|null) {return x;} }",
            "C.read()",
            "wrong number of class arguments",
        ),
        (
            "class C { constructor(x: number|null) {} } class D extends C {constructor(){super();}}",
            "new D()",
            "wrong number of class arguments",
        ),
        (
            "const state = { n: 0 }; function next(): number { state.n++; return state.n; } class C { value = next(); }",
            "new C()",
            "this field needs a type annotation",
        ),
        (
            "class C { static value: number = 'wrong'; }",
            "C.value",
            "static field initializer does not match",
        ),
        (
            "class C { constructor(public n: number = 1, public prior: number = this.n) {} }",
            "new C()",
            "can't assign number | undefined",
        ),
        (
            "class C {} class D extends C { constructor(public n: number = this.n) { super(); } }",
            "new D()",
            "before `super()` in a derived constructor",
        ),
        (
            "class C { #secret = 1; } class D { static read(d: D) { return d.#secret; } }",
            "D.read(new D())",
            "private name `#secret` must be declared in an enclosing class",
        ),
        (
            "class C { #n = 1; constructor() { this.#check(); } #check(): number { return this.#n; } }",
            "new C()",
            "method calls during construction",
        ),
        (
            "class C { constructor(public toJSON: () => number) {} }",
            "new C(() => 1)",
            "protocol class members",
        ),
        (
            "class C { get value() { return 1; } }",
            "(() => { const c = new C(); c.value = 2; return 1; })()",
            "getter without a setter",
        ),
        (
            "class C { set value(v: number) {} }",
            "new C().value",
            "has only a setter",
        ),
        (
            "class C { toJSON(): string { return 'c'; } }",
            "new C()",
            "class instances with a toJSON method",
        ),
        (
            "class C {} const factory = () => C; class D extends factory() {}",
            "new D()",
            "dynamic class inheritance",
        ),
        (
            "class C { value = 1; read(): number { return this.value; } }",
            "(() => { const c = new C(); return c.read; })()",
            "extracting class methods",
        ),
        (
            "class C { value = 1; constructor() { this.read(); } read(): number { return this.value; } }",
            "new C()",
            "method calls during construction",
        ),
        (
            "class C {} class D extends C { constructor() { super(); super(); } }",
            "new D()",
            "super() outside the first",
        ),
        (
            "class C { value = 1; }",
            "(JSON.parse('{}') as C)",
            "assertions cannot restore class identity",
        ),
        (
            "class C { value = 1; }",
            "1",
            "JSON schemas cannot use class instance types",
        ),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        // A class can't type a stored JSON value either.
        let fields = if message == "JSON schemas cannot use class instance types" {
            "{ value: json<C>().optional() }"
        } else {
            "{}"
        };
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{ table, json, defineConfig, mutation }} from 'typedpress';\n{declarations}\nconst __n = table({fields}); export {{ __n as n }}; const __test = mutation({{}}, () => {handler}); export {{ __test as test }}; export default defineConfig({{}});\n")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{message}: {report}");
        let diagnostic = report["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["message"].as_str().unwrap().contains(message))
            .unwrap_or_else(|| panic!("expected {message}: {report}"));
        assert_eq!(diagnostic["location"]["file"], "typedpress.config.ts", "{report}");
        assert!(diagnostic["location"]["line"].as_u64().unwrap() >= 2);
    }
}

/// The standard host forms (global fetch, Headers, URLSearchParams, process.env, crypto and
/// node:crypto) give Node's results through the generated PHP, against one shared HTTP origin.
#[test]
fn host_globals_match_node_through_generated_php() {
    let dir = root().join("tests/differential");
    let mut origin = Command::new("node")
        .arg(dir.join("host-origin.mjs"))
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let port = {
        use std::io::BufRead as _;
        let mut line = String::new();
        std::io::BufReader::new(origin.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        line.trim().to_string()
    };
    struct Kill(std::process::Child);
    impl Drop for Kill {
        fn drop(&mut self) {
            let _ = self.0.kill();
        }
    }
    let _origin = Kill(origin);
    let secret = " lane secret \n";
    let tmp = tempfile::tempdir().unwrap();
    project_from(
        tmp.path(),
        &dir.join("host-globals.ts"),
        &[&dir.join("host-crypto.cjs")],
    );
    let js = tmp.path().join("node");
    let transpiled = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .args(["--noCheck", "--target", "ES2022", "--module", "ESNext", "--outDir"])
        .arg(&js)
        .arg(dir.join("host-globals.ts"))
        .output()
        .unwrap();
    assert!(
        transpiled.status.success(),
        "{}",
        String::from_utf8_lossy(&transpiled.stdout)
    );
    // The config imports its CommonJS helper, which Node loads with its own require.
    let module = std::fs::read_to_string(js.join("host-globals.js")).unwrap();
    std::fs::write(js.join("typedpress.config.mjs"), module).unwrap();
    std::fs::copy(dir.join("host-crypto.cjs"), js.join("host-crypto.cjs")).unwrap();
    // Node reads the origin directly; the PHP side sees the same answers through the stub.
    let node = Command::new("node")
        .arg(dir.join("run-node.mjs"))
        .arg(js.join("typedpress.config.mjs"))
        .env("HOST_URL", format!("http://127.0.0.1:{port}"))
        .env("HOST_SECRET", secret)
        .env_remove("HOST_UNSET")
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(expected["complete"], true);
    let mut expected = expected["cases"].clone();
    assert_eq!(expected.as_object().unwrap().len(), 11, "{expected}");
    assert!(
        expected.as_object().unwrap().values().all(|c| c.get("data").is_some()),
        "{expected}"
    );
    // Zero trims a process.env HMAC key (0.8's keyring rule); Node uses it as given.
    assert_eq!(expected["secrets"]["data"][0], false);
    expected["secrets"]["data"][0] = json!(true);
    let content = build_wp(tmp.path());
    let out = Command::new("php")
        .args([
            "-r",
            r#"
require $argv[1];
require $argv[3];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$out = [];
foreach ($schema['actions'] as $name => $action) {
    $fn = '\\TypedPressApp\\' . $action['handler'];
    try { $out[$name] = ['data' => $fn(new \TypedPress\JsObject(), \TypedPress\Seam::ctx(['user' => null]))]; }
    catch (\Throwable $e) { $out[$name] = ['error' => $e->getMessage()]; }
}
echo \TypedPress\Js::jsonStringify($out);
"#,
        ])
        .arg(content.join("plugins/typedpress-runtime/tp/bootstrap.php"))
        .arg(content.join("plugins/typedpress-app-host-globals/tp/app"))
        .arg(dir.join("host-wp-http.php"))
        // The PHP side fetches the public name; the policy checks it, the stub connects locally.
        .env("HOST_URL", format!("https://origin.example:{port}"))
        .env("HOST_ORIGIN", &port)
        .env("HOST_SECRET", secret)
        .env_remove("HOST_UNSET")
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(out.stderr.is_empty(), "{}", String::from_utf8_lossy(&out.stderr));
    let actual: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(actual, expected, "generated PHP differs from Node");
}

/// `typedpress check --json` reports each plugin's package, integrity, locked and inferred grant, and
/// the handlers that read data and send it out. A report, not a refusal: the check succeeds.
#[test]
fn check_reports_plugin_grants_and_read_to_send_flows() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(tmp.path().join("node_modules/typedpress-plugin-sync/src")).unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        r#"import { collection, defineConfig, text } from "typedpress";
import sync from "typedpress-plugin-sync";
const posts = collection({ title: text() }, { title: "title" });
export { posts }; export default defineConfig({ name: "flows", use: [sync()] });"#,
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("node_modules/typedpress-plugin-sync/package.json"),
        r#"{ "name": "typedpress-plugin-sync", "version": "3.1.0", "exports": "./src/index.ts" }"#,
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("node_modules/typedpress-plugin-sync/src/index.ts"),
        r#"import { db, definePlugin, mutation } from "typedpress";
import { abilities, esc_html } from "php/wordpress";
import { createHmac } from "node:crypto";
// The send happens in a helper the handler calls with what it read. Package TypeScript compiles
// as checked JavaScript, where awaiting a helper's result isn't supported, so the helper awaits.
async function push(body: string) {
  const response = await fetch(new URL("https://hooks.example.com/in"), { method: "POST", body: String(body), headers: { authorization: process.env.SYNC_KEY ?? "", "x-signature": createHmac("sha256", process.env.SYNC_SIGNING!).update(body).digest("hex") } });
  return response.status;
}
export default () => definePlugin({
  name: "sync",
  actions: {
    export: mutation({}, async () => { const rows = await db.query.posts.findMany(); push(JSON.stringify(rows)); return true; }),
    count: mutation({}, async () => { return (await db.query.posts.findMany()).length; }),
    // A WordPress ability is a capability like any other: here the app's own `posts` list.
    list: mutation({}, async () => { const rows = await abilities.call("flows/posts-list", {}); return rows; }),
    // So is a WordPress function, recorded with the module it comes from.
    title: mutation({}, () => { return esc_html("<b>"); }),
  },
});"#,
    )
    .unwrap();
    // A first local check, before any lock exists. Under CI the same plugin is refused until a
    // lock is committed, which is its own assertion below.
    let out = first()
        .env_remove("CI")
        .args(["check", "--json"])
        .arg(tmp.path())
        .output()
        .unwrap();
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(out.status.success(), "{report}");
    let plugin = &report["plugins"][0];
    assert_eq!(plugin["package"], "typedpress-plugin-sync");
    assert_eq!(plugin["version"], "3.1.0");
    assert!(plugin["integrity"].as_str().unwrap().starts_with("sha256-"));
    assert_eq!(plugin["status"], "added");
    assert_eq!(plugin["inferred"]["read"], json!(["posts"]));
    assert_eq!(plugin["inferred"]["http"], json!(["hooks.example.com"]));
    // The global forms are capabilities like the old imports were: process.env reads, including a
    // createHmac key read from process.env, and the global fetch's static host.
    assert_eq!(plugin["inferred"]["env"], json!(["SYNC_KEY", "SYNC_SIGNING"]));
    assert_eq!(
        plugin["inferred"]["actions"],
        json!(["sync_count", "sync_export", "sync_list", "sync_title"])
    );
    assert_eq!(plugin["inferred"]["abilities"], json!(["flows/posts-list"]));
    assert_eq!(plugin["inferred"]["php"], json!(["php/wordpress:esc_html"]));
    assert_eq!(plugin["inferred"]["wpHooks"], json!([]));
    // Only the handler that reads and then sends, through its helper, is flagged.
    assert_eq!(
        plugin["flows"],
        json!([{
            "handler": "plugin_sync__action__sync_export",
            "reads": ["env: SYNC_KEY", "env: SYNC_SIGNING", "read: posts"],
            "sends": ["http: hooks.example.com"],
        }])
    );
    assert!(!tmp.path().join("tp/_generated").exists(), "check writes no lock");
    let frozen = first()
        .args(["check", "--json", "--frozen"])
        .arg(tmp.path())
        .output()
        .unwrap();
    let report: Value = serde_json::from_slice(&frozen.stdout).unwrap();
    assert_eq!(frozen.status.code(), Some(1), "{report}");
    assert_eq!(report["diagnostics"][0]["code"], "F4201");
    assert!(
        report["diagnostics"][0]["message"]
            .as_str()
            .unwrap()
            .contains("plugin \"sync\" (typedpress-plugin-sync@3.1.0) isn't in tp/_generated/plugins.lock.json"),
        "{report}"
    );
}

#[test]
fn installed_package_typescript_is_type_erased_like_javascript_and_matches_node() {
    let tmp = tempfile::tempdir().unwrap();
    let package = tmp.path().join("node_modules/typed-lib");
    std::fs::create_dir_all(package.join("src")).unwrap();
    std::fs::write(
        package.join("package.json"),
        r#"{"name":"typed-lib","type":"module","exports":{".":{"types":"./src/index.d.ts","import":"./src/index.ts"}}}"#,
    )
    .unwrap();
    // Every type-level construct here is refused in authored code or exceeds TypedPress's type subset.
    std::fs::write(
        package.join("src/index.ts"),
        r#"import type { Shape } from "./shape.js";
import { Named, describe } from "./shape.js";

export type Mapper = <T>(value: T, index?: number, ...rest: unknown[]) => T;
interface Callable { (input: string): string; new (input: string): object; readonly [key: string]: unknown }
declare const brand: unique symbol;
type Branded = { readonly [brand]: true };
type Keys<T> = { [K in keyof T as `get${string & K}`]: () => T[K] };

export function assertText(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new TypeError("expected text");
}

function identity<T>(value: T): T { return value; }
const map: Mapper = (value) => value;

abstract class Base<T> {
  abstract label(): string;
  declare readonly hidden: number;
  protected readonly unit: string = "item";
  push(this: Base<T>, item: T | string = ""): string { return `${this.unit}+${item}`; }
  size(): string { return this.unit; }
}

export class Box extends Base<string> implements Named {
  name = "box";
  label(): string { return `${this.name}:${this.size()}`; }
  overloaded(value: string): string;
  overloaded(value: number): string;
  overloaded(value: string | number = 0): string { return String(value); }
}

export function run(input: string): Record<string, unknown> {
  assertText(input);
  const tools: { shape(this: void, text: string): string; count: (...items: string[]) => number } = {
    shape(text) { return `[${text}]`; },
    count: (...items) => items.length,
  };
  const box = new Box();
  const pushed = identity<string>(input) + (map(input) as string);
  const shape = { kind: "circle", radius: 2 } satisfies Shape;
  const value = <number>shape.radius!;
  return { boxed: box instanceof Box, described: describe(shape), value, pushed, shaped: tools.shape(input), counted: tools.count("a", "b") };
}
"#,
    )
    .unwrap();
    std::fs::write(
        package.join("src/shape.ts"),
        r#"export interface Named { name: string }
export type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
export const describe = (shape: Shape): string => (shape.kind === "circle" ? `r=${shape.radius}` : `s=${shape.side}`);
"#,
    )
    .unwrap();
    // The oracle is the same source with types stripped by tsc, run under Node.
    let js = tmp.path().join("node");
    let transpiled = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .args(["--noCheck", "--target", "ES2022", "--module", "ESNext", "--outDir"])
        .arg(&js)
        .arg(package.join("src/index.ts"))
        .arg(package.join("src/shape.ts"))
        .output()
        .unwrap();
    assert!(
        transpiled.status.success(),
        "{}",
        String::from_utf8_lossy(&transpiled.stdout)
    );
    std::fs::write(js.join("package.json"), r#"{"type":"module"}"#).unwrap();
    let node = Command::new("node")
        .current_dir(&js)
        .args([
            "--input-type=module",
            "-e",
            "import { run } from './index.js'; process.stdout.write(JSON.stringify(run('hi')));",
        ])
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        r#"
import { defineConfig, text, mutation } from 'typedpress';
import { run } from 'typed-lib';
const __probe = mutation({}, (input: { key: string }) => run(input.key)); export { __probe as probe }; export default defineConfig({ name: 'typed-lib' });
"#,
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let actual = php(
        r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$fn = '\\TypedPressApp\\' . $schema['actions']['probe']['handler'];
$input = new \TypedPress\JsObject();
$input->p['key'] = 'hi';
echo \TypedPress\Js::jsonStringify($fn($input, new \TypedPress\JsObject()));
"#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-typed-lib/tp/app"),
        ],
    );
    assert_eq!(actual, expected);

    // The app's own code stays statically checked: package values are JavaScript values,
    // and package types are not silently trusted.
    for (source, message) in [
        (
            "import { run } from 'typed-lib'; const read = (key: string): string => { const value: string = run(key); return value; };",
            "a JavaScript value isn't assignable to string",
        ),
        (
            "import { run, Mapper } from 'typed-lib'; const read = (key: string) => run(key);",
            "`Mapper` comes from an installed package or JavaScript module, whose types TypedPress erases",
        ),
        (
            "import { run, type Mapper } from 'typed-lib'; const read = (key: string) => { const map: Mapper | null = null; return run(key); };",
            "`Mapper` comes from an installed package or JavaScript module, whose types TypedPress erases",
        ),
    ] {
        std::fs::write(
            tmp.path().join("typedpress.config.ts"),
            format!(
                "import {{ defineConfig, text, mutation }} from 'typedpress'; {source} const __probe = mutation({{}}, (input: {{ key: string }}) => read(input.key)); export {{ __probe as probe }}; export default defineConfig({{}});"
            ),
        )
        .unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        assert!(
            report["diagnostics"]
                .as_array()
                .unwrap()
                .iter()
                .any(|d| d["message"].as_str().unwrap().contains(message)),
            "{source}: {report}"
        );
    }
}

#[test]
fn checked_javascript_reads_and_calls_inherited_class_methods_like_node() {
    let tmp = tempfile::tempdir().unwrap();
    write_app(
        tmp.path().join("tp/helper.js"),
        r#"
        class C { m() { return 4; } }
        class D extends C {}
        function read(x, name) { return typeof x[name]; }
        function invoke(x, name) { return x[name](); }
        export function test() {
            const instance = new D();
            const results = [];
            for (const f of [() => read(instance, 'm'), () => invoke(instance, 'm')]) {
                try { results.push(f()); } catch (e) { results.push([e.name, e.message]); }
            }
            results.push(instance.m === new C().m, instance.m.call({}), read(instance, 'missing'));
            return results;
        }
    "#,
    )
    .unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress'; import {test} from './tp/helper.js'; const __test = mutation({}, ()=>test()); export { __test as test }; export default defineConfig({ name:'classboundary' });").unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/typedpress-app-classboundary/tp/app");
    let actual = php(
        r#"
        require $argv[1];
        require $argv[2] . '/functions.php';
        echo \TypedPress\Js::jsonStringify(\TypedPressApp\action__test());
    "#,
        &[&content.join("plugins/typedpress-runtime/tp/bootstrap.php"), &app],
    );
    let node = Command::new("node")
        .current_dir(tmp.path())
        .args([
            "--input-type=module",
            "-e",
            "import {test} from './tp/helper.js'; process.stdout.write(JSON.stringify(test()));",
        ])
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(expected, json!(["function", 4, true, 4, "undefined"]));
    assert_eq!(actual, expected);
}

#[test]
fn symbols_and_weak_collections_match_node_in_imported_javascript() {
    let tmp = tempfile::tempdir().unwrap();
    // The files-sdk patterns: a registered brand defined nonenumerable on an object, a
    // symbol-keyed spread wrapper, and module-level WeakMap state per instance.
    let helper = r#"
const BRAND = Symbol.for("files-sdk.FilesError");
const LOCAL = Symbol("local");
const BARE = Symbol();
const internals = new WeakMap;
const seen = new WeakSet();
const isObject = (value) => typeof value === "object" && value !== null;
const attempt = (f) => { try { return f(); } catch (e) { return e.name; } };
export function brand(target) { Object.defineProperty(target, BRAND, { value: true }); return target; }
export function isBranded(value) { return isObject(value) && Object.hasOwn(value, BRAND) && value[BRAND] === true; }
export function local() { return LOCAL; }
// Built-in prototypes carry well-known symbol methods TypedPress doesn't model: refused, not guessed.
export function unmodeled() {
  const list = [1];
  return [() => Symbol.iterator in list, () => list[Symbol.iterator], () => Symbol.hasInstance in isObject].map((f) => { try { return f(); } catch (e) { return [e.name, e.message]; } });
}
class Holder {}
const class_instance = () => new Holder();
export function probe() {
  const branded = brand({ code: "NotFound" });
  const plain = { code: "x" };
  const wrapped = { ...plain, [LOCAL]: 3, extra: 1, ["__proto__"]: 4 };
  const copy = { ...wrapped, ..."ab", ...null, ...[7] };
  internals.set(plain, { loaded: 0 });
  internals.get(plain).loaded += 5;
  seen.add(plain).add(LOCAL);
  const forIn = []; for (const key in wrapped) forIn.push(key);
  const fresh = Symbol("local");
  const list = [1];
  return {
    typeofs: [typeof BRAND, typeof Symbol.iterator, typeof Symbol, typeof WeakMap, typeof globalThis.Symbol, typeof globalThis.window, typeof globalThis.Bun, typeof internals],
    identity: [BRAND === Symbol.for("files-sdk.FilesError"), LOCAL === fresh, LOCAL === local(), Symbol.keyFor(BRAND), Symbol.keyFor(LOCAL) === undefined, Symbol.iterator === Symbol.iterator, BRAND == Symbol.for("files-sdk.FilesError")],
    strings: [String(BRAND), LOCAL.toString(), LOCAL.description, BARE.description === undefined, String(BARE), String(Symbol.asyncIterator), Symbol.hasInstance.description, Symbol.toStringTag.toString(), String(Symbol(42))],
    branded: [isBranded(branded), isBranded(plain), Object.keys(branded), JSON.stringify(branded), branded[BRAND], attempt(() => { branded[BRAND] = false; return branded[BRAND]; })],
    wrapped: [Object.keys(wrapped), wrapped[LOCAL], copy[LOCAL], JSON.stringify(copy), Object.hasOwn(copy, LOCAL), Object.hasOwn(copy, BRAND), copy[BRAND] === undefined, forIn, Object.entries(wrapped).length],
    json: [JSON.stringify([LOCAL, 1]), JSON.stringify({ s: LOCAL }), JSON.stringify(LOCAL) === undefined],
    weak: [internals.get(plain).loaded, internals.has(plain), internals.has({}), internals.get("text") === undefined, internals.delete(plain), internals.has(plain), seen.has(plain), seen.has(LOCAL), seen.delete(plain), seen.has(plain), new WeakMap([[plain, 2]]).get(plain), String(internals)],
    errors: [attempt(() => internals.set("text", 1)), attempt(() => internals.set(undefined, 1)), attempt(() => seen.add(BRAND)), attempt(() => `${LOCAL}`), attempt(() => LOCAL + 1), attempt(() => +LOCAL), attempt(() => new WeakSet([1]))],
    detect: [globalThis.window === undefined, globalThis.Bun !== undefined],
    // A class prototype is modeled exactly, so a symbol it lacks is absent on an instance.
    classes: [class_instance()[BRAND] === undefined, BRAND in class_instance(), Symbol.iterator in class_instance()],
    operators: [BRAND in branded, BRAND in plain, LOCAL in wrapped, LOCAL in copy, "code" in branded, BRAND in list, list[BRAND] === undefined, attempt(() => delete branded[BRAND]), delete copy[LOCAL], LOCAL in copy, delete plain[BRAND], attempt(() => BRAND in "text")],
  };
}
"#;
    write_app(tmp.path().join("tp/helpers.mjs"), helper).unwrap();
    let node = Command::new("node")
        .current_dir(tmp.path())
        .args([
            "--input-type=module",
            "-e",
            "import {probe} from './tp/helpers.mjs'; process.stdout.write(JSON.stringify(probe()));",
        ])
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        "import { defineConfig, mutation } from 'typedpress'; import { probe, unmodeled } from './tp/helpers.mjs'; const __probe = mutation({}, () => probe()); export { __probe as probe }; const __unmodeled = mutation({}, () => unmodeled()); export { __unmodeled as unmodeled }; export default defineConfig({ name: 'symbols' });",
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let actual = php(
        r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$run = fn ($name) => ('\\TypedPressApp\\' . $schema['actions'][$name]['handler'])(new \TypedPress\JsObject(), new \TypedPress\JsObject());
echo \TypedPress\Js::jsonStringify(new \TypedPress\JsArray([$run('probe'), $run('unmodeled')]));
"#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-symbols/tp/app"),
        ],
    );
    let refused = json!([
        "TypeError",
        "Symbol-keyed properties are only supported on plain objects"
    ]);
    assert_eq!(actual, json!([expected, [refused, refused, refused]]));

    // Authored TypeScript has no symbol type and no weak collections; both are located refusals.
    for (source, message) in [
        (
            "const s = Symbol('x'); const __a = mutation({}, () => typeof s); export { __a as a }; export default defineConfig({});",
            "symbols aren't supported in TypeScript code yet",
        ),
        (
            "const __a = mutation({}, () => typeof Symbol.for('x')); export { __a as a }; export default defineConfig({});",
            "symbols aren't supported in TypeScript code yet",
        ),
        (
            "const __a = mutation({}, () => { const m = new WeakMap(); return 1; }); export { __a as a }; export default defineConfig({});",
            "`new WeakMap` isn't supported",
        ),
        (
            "const m = new WeakMap(); const __a = mutation({}, () => typeof m); export { __a as a }; export default defineConfig({});",
            "which TypeScript code here can't use",
        ),
        (
            "const m = new WeakMap([[{}, 1]]); export default defineConfig({});",
            "unsupported overload of `constructor.WeakMap`",
        ),
        (
            "const k = Symbol('k'); const o = { [k]: 1 }; export default defineConfig({});",
            "symbol-keyed properties can't be created while the config is evaluated",
        ),
        (
            "const __a = mutation({}, () => typeof globalThis.Buffer); export { __a as a }; export default defineConfig({});",
            "`globalThis.Buffer` depends on the host",
        ),
        (
            "const __a = mutation({}, () => typeof globalThis.myPolyfill); export { __a as a }; export default defineConfig({});",
            "`globalThis.myPolyfill` depends on the host",
        ),
        (
            "const f = typeof globalThis.fetch; export default defineConfig({});",
            "`globalThis.fetch` depends on the host",
        ),
        (
            "const __a = mutation({}, () => globalThis.Bun()); export { __a as a }; export default defineConfig({});",
            "`globalThis.Bun` is undefined in TypedPress",
        ),
    ] {
        std::fs::remove_file(tmp.path().join("tp/helpers.mjs")).ok();
        std::fs::write(
            tmp.path().join("typedpress.config.ts"),
            format!("import {{ defineConfig, mutation }} from 'typedpress';\n{source}"),
        )
        .unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{source}: {report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(
            diagnostic["message"].as_str().unwrap().contains(message),
            "{source}: {report}"
        );
        assert!(diagnostic["location"].is_object(), "{source}: {report}");
        assert!(diagnostic["help"].is_string(), "{source}: {report}");
    }
}

#[test]
fn builtin_vectors_agree_in_evaluation_generated_php_and_node() {
    let vectors: Value = serde_json::from_str(include_str!("differential/builtin-vectors.json")).unwrap();
    let tmp = tempfile::tempdir().unwrap();
    let mut declarations = String::new();
    let mut actions = Vec::new();
    let mut javascript = String::new();
    for v in vectors.as_array().unwrap() {
        let name = v["name"].as_str().unwrap();
        let expression = v["expression"].as_str().unwrap();
        if let Some(files) = v["files"].as_object() {
            for (name, source) in files {
                write_app(tmp.path().join("tp").join(name), source.as_str().unwrap()).unwrap();
            }
        }

        if let Some(source) = v["declarations"].as_str() {
            declarations.push_str(source);
            declarations.push('\n');
        }
        let body = if v["javascript"] == true {
            javascript.push_str(&format!("export const js_{name} = () => ({expression});\n"));
            declarations.push_str(&format!("import {{js_{name}}} from './helper.js';\n"));
            format!("js_{name}()")
        } else {
            expression.to_string()
        };
        actions.push(format!("export const {name} = mutation({{}}, () => ({body}));"));
        if v["fold"] == true {
            declarations.push_str(&format!("const folded_{name}_value = {expression};\n"));
            actions.push(format!(
                "export const folded_{name} = mutation({{}}, () => folded_{name}_value);"
            ));
        }
    }
    write_app(tmp.path().join("tp/helper.js"), javascript).unwrap();
    // The app and its helper modules live under tp/; the root config re-exports it.
    let entry = tmp.path().join("tp/app.ts");
    std::fs::write(&entry, format!("import {{ defineConfig, mutation }} from 'typedpress';\n{declarations}\n{}\nexport default defineConfig({{name: 'builtinparity'}});", actions.join("\n"))).unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        "export { default } from './tp/app.ts';\n",
    )
    .unwrap();
    let node = Command::new("node")
        .arg(root().join("tests/differential/run-node.mjs"))
        .arg(&entry)
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/typedpress-app-builtinparity/tp/app");
    let actual = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $out = new \TypedPress\JsObject();
        foreach ($schema['actions'] as $name => $action) {
            $fn = '\TypedPressApp\\' . $action['handler'];
            $out->p[$name] = new \TypedPress\JsObject(['data' => $fn(new \TypedPress\JsObject(), \TypedPress\Seam::ctx(['user' => null]))]);
        }
        echo \TypedPress\Js::jsonStringify($out);
    "#,
        &[&content.join("plugins/typedpress-runtime/tp/bootstrap.php"), &app],
    );
    assert_eq!(actual, expected["cases"]);
}

#[test]
fn unsupported_builtin_overloads_are_located_in_both_phases() {
    for expression in [
        "(() => {let x='outer';switch(1){case 1:let x='inner';case 2:return x;}})()",
        "(() => {switch(1){case 1:const x=1;return x;}})()",
        "(() => {switch(1){case 1:function f(){return 1;}return f();}})()",
        "(() => {switch(1){case 1:class C{}return new C();}})()",
        r#"new RegExp("(*ACCEPT)")"#,
        "process.arch",
        "navigator.userAgent",
        "typeof require",
        "typeof crypto",
        "typeof globalThis.Buffer",
        "(() => { const o = {n: 1}; Object.freeze(o); try {o.n = 2;} catch {} return o.n; })()",
        "(() => { const o: Record<string, number> = {}; o['__proto__'] = 1; return Object.hasOwn(o, '__proto__'); })()",
        "JSON.stringify({toJSON: () => 42})",
        "JSON.stringify(new Date(0))",
        "JSON.stringify({date: new Date(0)})",
        "JSON.stringify(structuredClone({date: new Date(0)}))",
        "new Date(0).getTime(1)",
        "new Date(0).toISOString(1)",
        "new Date(0).toJSON(1)",
        "Math.log(3)",
        "Math.exp(1)",
        "Math.pow(3, 35)",
        "Math.pow(45.29, -1)",
        "45.29 ** -1",
        "10 ** -2",
        "Math.pow(1.3, 0.3)",
        "'abc'.replace(/(?<=([ab]{1,2})([bc]{1,2}))$/, '[$1][$2]')",
        "'abc'.replace(/(?<!([ab]{1,2})([bc]{1,2}))$/, '[$1][$2]')",
        "'aba'.replace(/(a(b)?)+/, '[$2]')",
        "'b'.replace(/(?:a*|b)*/, 'X')",
        "'aba'.replace(/(?:a*|b)*/g, 'X')",
        "'b'.replace(/(?:a*|b)?/, 'X')",
        r"/[\uD800]/.test('?')",
        r"/[^\uD800]/u.test('?')",
        r"/[\u{D800}]/u.test('?')",
        r"/\uD83D\uDE42?/.test('a')",
        "/🙂?/.test('a')",
        r"/[a-\uD83D\uDE42]/.test('\uE000')",
        "'x'.replace(/(a*)?/, 'X')",
        r"'x'.replace(/(a*\b)?/, 'X')",
        r"'x'.replace(/(\b)?/, 'X')",
        "'x'.replace(/()?/, 'X')",
        "'x'.replace(/(?<g>a*)?/, 'X')",
        "'x'.replace(/[a-z--x]/g, '!')",
        "Object.hasOwn(() => 1, 'length')",
        "JSON.stringify({x: undefined})",
        "Error(undefined)",
        "new Error('build-time')",
        "(1).toFixed(2, 3)",
        "new RegExp('a', '', 3)",
        "[2, 1].sort(...[(x: number, y: number) => y - x])",
        "[1].map(n => n, ...[{}])",
        "'a]'.replace(/[a[b]]/, 'X')",
        "'a]'.replace(/[^]]/, 'X')",
        "'abc'.includes('a', 1)",
        "'abc'.startsWith('b', 1)",
        "'abc'.endsWith('b', 2)",
        "'ä'.localeCompare('z')",
        r"/\p{Script=Greek}/u.test('a')",
        r"/\p{Lu}/iu.test('a')",
        r"/[\p{Lu}]/iu.test('a')",
        r"/\P{Ll}/iu.test('a')",
        r"/[\P{Ll}]/iu.test('a')",
        "'a'.trim('x')",
        "(42).toString(16)",
        "[1].map(n => n, {})",
        "Array.from([1], n => n, {})",
        "JSON.stringify({a: 1}, null, 2)",
        "parseFloat('1', 2)",
        "Math.abs(1, 2)",
        "parseInt('120101100002111211120012010111012200200201', 3)",
        "parseInt('14mnsu689fka', 36)",
    ] {
        for handler in [false, true] {
            // Configuration evaluation spreads arguments; compiled handlers refuse spread calls.
            if !handler && expression.contains("(...[") {
                continue;
            }
            // These contracts have different evaluator and emitter support.
            if handler
                && (expression.starts_with("JSON.stringify")
                    && !expression.contains("toJSON")
                    && !expression.contains("Date")
                    || expression.starts_with("Error(")
                    || expression.starts_with("new Error(")
                    || expression.contains("[a[b]]")
                    || expression.contains("[^]]")
                    || expression.contains("[a-z--x]"))
            {
                continue;
            }
            let tmp = tempfile::tempdir().unwrap();
            let (declaration, result) = if handler {
                (String::new(), expression.to_string())
            } else {
                (format!("const folded = {expression};"), "folded".into())
            };
            std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\n{declaration}\nconst __probe = mutation({{}}, ()=>{result}); export {{ __probe as probe }}; export default defineConfig({{ name:'refusal' }});")).unwrap();
            let (out, report) = checked(tmp.path());
            assert_eq!(out.status.code(), Some(1), "{expression}, handler={handler}: {report}");
            let diagnostic = &report["diagnostics"][0];
            assert!(diagnostic["location"].is_object(), "{expression}: {report}");
            assert!(diagnostic["help"].is_string(), "{expression}: {report}");
        }
    }
}

#[test]
fn javascript_invalid_regex_literals_receive_syntax_diagnostics() {
    for expression in ["/a++a/g", r"/[\k<a>]/u"] {
        let mut node = Command::new("node")
            .args(["--check", "--input-type=module"])
            .stdin(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        std::io::Write::write_all(node.stdin.as_mut().unwrap(), expression.as_bytes()).unwrap();
        drop(node.stdin.take());
        let node = node.wait_with_output().unwrap();
        assert!(!node.status.success(), "{expression}");
        assert!(String::from_utf8_lossy(&node.stderr).contains("SyntaxError"));
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';const __probe = mutation({{}}, ()=>{expression}); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{expression}: {report}");
        let diagnostic = &report["diagnostics"][0];
        assert_eq!(diagnostic["category"], "invalid-source", "{report}");
        assert_eq!(diagnostic["code"], "F1001", "{report}");
        assert!(
            diagnostic["message"].as_str().unwrap().starts_with("syntax error:"),
            "{report}"
        );
        assert_eq!(diagnostic["location"]["file"], "typedpress.config.ts");
    }
}

#[test]
fn unsupported_features_have_positions_and_actionable_help() {
    for (source, message) in [
        (
            "const helper = (value: any) => value; return helper('x');",
            "`any` isn't allowed",
        ),
        ("function* numbers() { yield 1; } return [...numbers()];", "generators"),
        ("return process.cwd();", "isn't available on `process`"),
        ("return new Map().size;", "an empty `new Map()` needs type arguments"),
        (
            "const m = new Map<string, number>(); m.set('a', 'b'); return m.size;",
            "\"b\" isn't assignable to number",
        ),
        (
            "const s: Set<number> = new Set<number>(); const t: Set<number | string> = s; return t.size;",
            "isn't assignable to Set<number | string>",
        ),
        (
            "const f=(value:string)=>typeof value; return f();",
            "missing required function arguments",
        ),
        (
            "function identity<T>(value: T): T { return value; } return identity('x');",
            "generic runtime functions aren't supported",
        ),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\nconst __probe = mutation({{}}, ()=>{{ {source} }}); export {{ __probe as probe }}; export default defineConfig({{ name:'diagnostics' }});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let d = &report["diagnostics"][0];
        assert!(d["message"].as_str().unwrap().contains(message), "{report}");
        assert!(d["location"].is_object(), "{report}");
        assert!(!d["help"].as_str().unwrap().is_empty(), "{report}");
    }
}

#[test]
fn configuration_refuses_unsupported_coercion_at_the_call_site() {
    for expression in [
        "'ab'.repeat({valueOf: () => 2})",
        "'abc'.slice({valueOf: () => 1})",
        "'a,b,c'.split(',', {valueOf: () => 2})",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\nconst result = {expression};\nconst __probe = mutation({{}}, ()=>result); export {{ __probe as probe }}; export default defineConfig({{ name:'coercion' }});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(diagnostic["message"].as_str().unwrap().contains("coercion"), "{report}");
        assert_eq!(diagnostic["location"]["line"], 2);
        assert!(diagnostic["help"].as_str().unwrap().contains("handler"));
    }
}

#[test]
fn query_calls_refuse_extra_options_arguments_at_the_call_site() {
    for method in ["findMany", "findFirst"] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, table, db, mutation}} from 'typedpress';\nconst notes = table({{}});\nexport {{ notes }}; const __probe = mutation({{}}, async()=>{{let n=0; await db.query.notes.{method}({{}}, n++); return n;}}); export {{ __probe as probe }}; export default defineConfig({{ name:'queryarity' }});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(
            diagnostic["message"]
                .as_str()
                .unwrap()
                .contains("at most one options argument"),
            "{report}"
        );
        assert_eq!(diagnostic["location"]["line"], 3);
        assert!(diagnostic["help"].as_str().unwrap().contains("one options object"));
    }
}

#[test]
fn database_builders_refuse_discarded_arguments_at_the_call_site() {
    for expression in [
        "db.insert(notes, n++).values({count: 1})",
        "db.insert((n++, notes)).values({count: 1})",
        "db.update(notes).where({id: n++}).set({count: n++})",
        "db.insert(notes).values({count: 1}, n++)",
        "db.delete(notes).where({id: 1}, n++)",
        "db.insert(notes).values({count: 1}).returning(n++)",
        "(n++, db.query.notes).findMany({})",
        "(n++, db.query).notes.findFirst({})",
        "(n++, db).query.notes.findMany({})",
        "(n++, db).insert(notes).values({count: 1})",
        "(n++, db.insert(notes)).values({count: 1})",
        "(n++, db.insert(notes).values({count: 1}))",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, table, integer, db, mutation}} from 'typedpress';\nconst notes=table({{count:integer().optional()}});\nexport {{ notes }}; const __probe = mutation({{}}, async()=>{{let n=0; await {expression}; return n;}}); export {{ __probe as probe }}; export default defineConfig({{ name:'builderarity' }});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(
            diagnostic["message"].as_str().unwrap().contains("unsupported"),
            "{report}"
        );
        assert_eq!(diagnostic["location"]["line"], 3);
        assert!(diagnostic["help"].is_string());
    }
}

#[test]
fn dynamic_large_radix_values_fail_as_an_explicit_runtime_refusal() {
    let actual = php(
        r#"
        require $argv[1];
        try {
            \TypedPress\Js::parseInt('120101100002111211120012010111012200200201', 3);
            echo json_encode(['accepted']);
        } catch (\TypedPress\JsError $error) {
            echo json_encode([$error->jsName, $error->getMessage()]);
        }
    "#,
        &[&root().join("runtime/TypedPress/bootstrap.php")],
    );
    assert_eq!(
        actual,
        serde_json::json!(["RangeError", "parseInt with this radix requires a safe integer result"])
    );
}

#[test]
fn configuration_validates_callbacks_before_empty_input_shortcuts() {
    for expression in [
        "Array.from([], null)",
        "[].map(null)",
        "[].reduce(null, 0)",
        "[].map(Math)",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\nconst value = (() => {{try {{ {expression}; return 0; }} catch (e) {{ return 1; }} }})();\nconst __probe = mutation({{}}, ()=>value); export {{ __probe as probe }}; export default defineConfig({{}});" )).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{expression}: {report}");
        let diagnostic = &report["diagnostics"][0];
        assert_eq!(diagnostic["message"], "callback must be a function", "{report}");
        assert_eq!(diagnostic["location"]["line"], 2, "{report}");
    }
}

#[test]
fn schema_builders_refuse_discarded_arguments_at_the_call_site() {
    for expression in [
        "text({}, 1)",
        "text().optional(false)",
        "text().default('x', 1)",
        "json<string>(1)",
        "select(['a'], 1)",
        "defineConfig({}, 1)",
        "mutation({}, ()=>1, 1)",
        "new HttpError(400, 'bad', 'message')",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{text, json, select, defineConfig, HttpError, mutation}} from 'typedpress';\nconst invalid = {expression};\nconst __probe = mutation({{}}, ()=>1); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{expression}: {report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(
            diagnostic["message"].as_str().unwrap().contains("unsupported overload"),
            "{report}"
        );
        assert_eq!(diagnostic["location"]["line"], 2, "{report}");
    }
}

#[test]
fn configuration_refuses_calls_that_lose_an_extracted_method_receiver() {
    for source in [
        "const trim=' x '.trim; const result=trim();",
        "const result=String(''.trim);",
        "const result=[''.trim].join(',');",
        "const result='abc'.includes(''.trim);",
        "const a=[1]; const result=a.map===a.map;",
        "const a=[1]; const result=a['map']===a['map'];",
        "const a=[1]; const result=[a.map].includes(a.map);",
        "const holder={method:' abc '.trim}; const result=holder.method();",
        "const holder={'method':' abc '.trim}; const result=holder['method']();",
        "const methods=[' abc '.trim]; const result=methods[0]();",
        "const methods=[' abc '.trim]; const result=methods['0']();",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\n{source}\nconst __probe = mutation({{}}, ()=>result); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{source}: {report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(
            diagnostic["message"].as_str().unwrap().contains("extracted methods"),
            "{report}"
        );
        assert_eq!(diagnostic["location"]["line"], 2);
    }
}

#[test]
fn prototype_setter_literals_are_refused_in_configuration_and_handlers() {
    // Only `__proto__: null` (a null-prototype object) is supported; any other value would
    // install a prototype.
    for (expression, folded) in [
        ("{__proto__: {}}", true),
        ("{'__proto__': {}}", false),
        ("{__proto__: Object.prototype}", true),
        ("{__proto__: undefined}", false),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        let declaration = if folded {
            format!("const result = Object.hasOwn({expression}, '__proto__');")
        } else {
            String::new()
        };
        let body = if folded {
            "result".into()
        } else {
            format!("Object.hasOwn({expression}, '__proto__')")
        };
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\n{declaration}\nconst __probe = mutation({{}}, ()=>{body}); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(
            diagnostic["message"]
                .as_str()
                .unwrap()
                .contains("prototype setter syntax"),
            "{report}"
        );
        assert!(diagnostic["location"].is_object());
        assert!(diagnostic["help"].as_str().unwrap().contains("computed"));
    }
}

#[test]
fn unknown_configuration_builtin_properties_are_located_refusals() {
    for expression in [
        "typeof 'x'.notReal",
        "typeof [].notReal",
        "typeof Math.notReal",
        "typeof /x/.global",
        "typeof [1, 2]['01']",
        "typeof [1, 2]['+1']",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\nconst folded={expression};\nconst __probe = mutation({{}}, ()=>folded); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{expression}: {report}");
        assert!(
            report["diagnostics"][0]["message"]
                .as_str()
                .unwrap()
                .contains("unsupported built-in property"),
            "{report}"
        );
        assert_eq!(report["diagnostics"][0]["location"]["line"], 2);
    }
}

#[test]
fn console_results_preserve_undefined_and_emit_the_log() {
    let tmp = tempfile::tempdir().unwrap();
    let entry = tmp.path().join("typedpress.config.ts");
    std::fs::write(&entry, "import {defineConfig, mutation} from 'typedpress'; const __probe = mutation({}, ()=>{const result=console.warn('builtin-return-marker');return [typeof result,result===undefined,result===null];}); export { __probe as probe }; export default defineConfig({ name:'logresult' });").unwrap();
    let node = Command::new("node")
        .arg(root().join("tests/differential/run-node.mjs"))
        .arg(&entry)
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    assert!(String::from_utf8_lossy(&node.stderr).contains("builtin-return-marker"));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/typedpress-app-logresult/tp/app");
    let actual = Command::new("php").args(["-r", r#"require $argv[1]; $schema=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\TypedPressApp\\'.$schema['actions']['probe']['handler'];echo \TypedPress\Js::jsonStringify($fn());"#]).arg(content.join("plugins/typedpress-runtime/tp/bootstrap.php")).arg(app).output().unwrap();
    assert!(actual.status.success(), "{}", String::from_utf8_lossy(&actual.stderr));
    assert!(String::from_utf8_lossy(&actual.stderr).contains("builtin-return-marker"));
    assert_eq!(
        serde_json::from_slice::<Value>(&actual.stdout).unwrap(),
        expected["cases"]["probe"]["data"]
    );
}

#[test]
fn dynamic_engine_dependent_math_fails_explicitly() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress'; const power=(base:number,exponent:number)=>Math.pow(base,exponent); const log=(value:number)=>Math.log(value); const exp=(value:number)=>Math.exp(value); const __probe = mutation({}, ()=>{const out:string[]=[];try{power(3,35);}catch{out.push('power');}try{power(45.29,-1);}catch{out.push('reciprocal');}try{log(3);}catch{out.push('log');}try{exp(1);}catch{out.push('exp');}return out;}); export { __probe as probe }; export default defineConfig({ name:'powerrefusal' });").unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$schema=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\TypedPressApp\\'.$schema['actions']['probe']['handler'];echo \TypedPress\Js::jsonStringify($fn());"#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-powerrefusal/tp/app"),
        ],
    );
    assert_eq!(result, json!(["power", "reciprocal", "log", "exp"]));
}

#[test]
fn configuration_refuses_unmodeled_inherited_properties() {
    for expression in [
        "(() => { const {toString='fallback'}={}; return typeof toString; })()",
        "(() => { const {valueOf}={}; return typeof valueOf; })()",
        "typeof ({}).toString",
        "typeof ({}).constructor",
        "typeof ({}).hasOwnProperty",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\nconst folded={expression};\nconst __probe = mutation({{}}, ()=>folded); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{expression}: {report}");
        assert!(
            report["diagnostics"][0]["message"]
                .as_str()
                .unwrap()
                .contains("inherited configuration properties"),
            "{report}"
        );
        assert_eq!(report["diagnostics"][0]["location"]["line"], 2);
    }
}

#[test]
fn json_annotations_refuse_unrepresentable_wire_values_at_the_source() {
    for annotation in [
        "undefined[]",
        "{ required: undefined }",
        "{ nested: { values: undefined[] } }",
        "Date",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{json,table,defineConfig}} from 'typedpress';\nconst __rows = table({{ values: json<{annotation}>().optional() }}); export {{ __rows as rows }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let d = &report["diagnostics"][0];
        assert_eq!(
            d["message"], "JSON schemas must accept their serialized values",
            "{report}"
        );
        assert_eq!(d["location"]["line"], 2);
        assert!(d["help"].as_str().unwrap().contains("null"));
    }
}

#[test]
fn action_results_refuse_implicit_typed_date_serialization() {
    for expression in ["new Date(0)", "({date: new Date(0)})", "[new Date(0)]"] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\nconst __probe = mutation({{}}, ()=>({expression})); export {{ __probe as probe }}; export default defineConfig({{}});" )).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let d = &report["diagnostics"][0];
        assert_eq!(d["message"], "typed Dates require explicit JSON serialization");
        assert_eq!(d["location"]["line"], 2);
        assert!(d["help"].as_str().unwrap().contains("action"));
    }
}

#[test]
fn typed_date_coercion_requires_explicit_formatting() {
    let tmp = tempfile::tempdir().unwrap();
    for expression in [
        "String(new Date(NaN))",
        "`${new Date(0)}`",
        "String([new Date(0)])",
        "[new Date(0)].join()",
        "new Date(0) + ''",
        "''.concat(new Date(0))",
    ] {
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\nconst __probe = mutation({{}}, ()=>({expression})); export {{ __probe as probe }}; export default defineConfig({{}});" )).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        assert_eq!(
            report["diagnostics"][0]["message"],
            "typed Date string coercion isn't supported"
        );
        assert_eq!(report["diagnostics"][0]["location"]["line"], 2);
    }
}

#[test]
fn dynamic_array_prototype_writes_are_refused() {
    let tmp = tempfile::tempdir().unwrap();
    write_app(tmp.path().join("tp/helper.js"), "export function probe(){const key='__proto__';const a=[];try {a[key]=1;} catch(e) {return [e.name,Object.hasOwn(a,key)];} return ['accepted'];}").unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress';import {probe} from './tp/helper.js';const __probe = mutation({}, ()=>probe()); export { __probe as probe }; export default defineConfig({ name:'prototyperefusal' });").unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$s=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\\TypedPressApp\\'.$s['actions']['probe']['handler'];echo \TypedPress\Js::jsonStringify($fn(new \TypedPress\JsObject(), \TypedPress\Seam::ctx(['user'=>null])));"#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-prototyperefusal/tp/app"),
        ],
    );
    assert_eq!(result, json!(["TypeError", false]));
}

#[test]
fn function_string_conversion_is_refused_at_known_and_dynamic_boundaries() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress';\nconst __probe = mutation({}, ()=>String(()=>1)); export { __probe as probe }; export default defineConfig({});").unwrap();
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1), "{report}");
    assert_eq!(
        report["diagnostics"][0]["message"],
        "function string coercion isn't supported"
    );
    assert_eq!(report["diagnostics"][0]["location"]["line"], 2);
    write_app(tmp.path().join("tp/helper.js"),
        "function convert(value){return String(value);} export function probe(){try{return convert(()=>1);}catch(e){return e.name;}}",
    )
    .unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress';import {probe} from './tp/helper.js';const __probe = mutation({}, ()=>probe()); export { __probe as probe }; export default defineConfig({ name:'functionrefusal' });").unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$s=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\\TypedPressApp\\'.$s['actions']['probe']['handler'];echo \TypedPress\Js::jsonStringify($fn(new \TypedPress\JsObject(),\TypedPress\Seam::ctx(['user'=>null])));"#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-functionrefusal/tp/app"),
        ],
    );
    assert_eq!(result, "TypeError");
}

#[test]
fn non_iso_date_literals_are_refused_at_the_call() {
    for text in ["2020-1-1", "-000000-01-01"] {
        for name in ["typedpress.config.ts", "tp/helper.js"] {
            let tmp = tempfile::tempdir().unwrap();
            if name == "tp/helper.js" {
                write_app(
                    tmp.path().join(name),
                    format!("export const probe=()=>new Date({text:?}).getTime();"),
                )
                .unwrap();
                std::fs::write(tmp.path().join("typedpress.config.ts"),"import {defineConfig, mutation} from 'typedpress';import {probe} from './tp/helper.js';const __probe = mutation({}, ()=>probe()); export { __probe as probe }; export default defineConfig({});").unwrap();
            } else {
                std::fs::write(tmp.path().join(name),format!("import {{defineConfig, mutation}} from 'typedpress';const __probe = mutation({{}}, ()=>new Date({text:?}).getTime()); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
            }
            let (out, report) = checked(tmp.path());
            assert_eq!(out.status.code(), Some(1), "{report}");
            assert_eq!(
                report["diagnostics"][0]["message"],
                "Date strings require the supported ISO format"
            );
            assert_eq!(report["diagnostics"][0]["location"]["file"], name);
        }
    }
}

#[test]
fn native_error_inspection_is_refused_during_configuration_evaluation() {
    let tmp = tempfile::tempdir().unwrap();
    write_app(tmp.path().join("tp/helper.js"), "export function probe(){try{arguments.callee;}catch(e){return [Object.hasOwn(e,'name'),Object.hasOwn(e,'message'),Object.keys(e)];}}").unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress';import {probe} from './tp/helper.js';const folded=probe();const __probe = mutation({}, ()=>folded); export { __probe as probe }; export default defineConfig({});").unwrap();
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1), "{report}");
    assert_eq!(
        report["diagnostics"][0]["message"],
        "restricted arguments properties aren't supported during configuration evaluation"
    );
    assert_eq!(report["diagnostics"][0]["location"]["file"], "tp/helper.js");
}

#[test]
fn undefined_cannot_be_narrowed_through_a_null_annotation_or_conditional_var() {
    for body in [
        "const r: string|null = ['a'].find(()=>false); return r!==null && Boolean(r);",
        "if(false) var x=1; return String(x+1);",
        "if(false) var x:number=1; return String(x+1);",
        "while(false) {var x=1;} return String(x+1);",
        "for(;false;) {var x=1;} return String(x+1);",
        "switch(0) {case 1: var x=1;} return String(x+1);",
        "try {if(true) throw Error('stop'); var x=1;} catch {} return String(x+1);",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"),format!("import {{defineConfig, mutation}} from 'typedpress';\nconst __probe = mutation({{}}, ()=>{{{body}}}); export {{ __probe as probe }}; export default defineConfig({{ name:'undefinedflow' }});" )).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{body}: {report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(diagnostic["location"].is_object(), "{body}: {report}");
    }
}

#[test]
fn engine_dependent_properties_and_unmodeled_flat_depths_are_located_refusals() {
    for (source, message) in [
        (
            "return /\\p{Lu}/u.test('Ᲊ');",
            "Unicode regex properties aren't supported",
        ),
        (
            "return new RegExp('\\\\p{Lu}', 'u').test('ÀB');",
            "Unicode regex properties aren't supported",
        ),
        (
            "return RegExp('\\\\P{Ll}', 'u').test('A');",
            "Unicode regex properties aren't supported",
        ),
        (
            r"return /[\w-a]/.test('-');",
            "character-class escapes adjacent to hyphens aren't supported",
        ),
        (
            r"return /[a-\d]/.test('`');",
            "character-class escapes adjacent to hyphens aren't supported",
        ),
        (
            r"return /\u1c89/iu.test('ᲊ');",
            "ignore-case regexes don't support encoded character escapes",
        ),
        (
            "return /É/iu.test('é');",
            "ignore-case regexes require ASCII source and input",
        ),
        (
            "return new Date('2000-01-01 24:00:00.0001Z').getTime();",
            "Date strings require the supported ISO format",
        ),
        (
            "return new Date('2000-01-01T00:00:00+0100').getTime();",
            "Date strings require the supported ISO format",
        ),
        (
            "return new Date('2000T00:00:00Z').getTime();",
            "Date strings require the supported ISO format",
        ),
        ("return [[1]].flat(2);", "typed flat() supports only depths 0 and 1"),
        (
            "return [[1]].flat({valueOf:()=>1});",
            "typed flat() supports only depths 0 and 1",
        ),
        (
            "const flatten=(depth:number)=>[[1]].flat(depth); return flatten(0);",
            "typed flat() supports only depths 0 and 1",
        ),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\nconst __probe = mutation({{}}, ()=>{{ {source} }}); export {{ __probe as probe }}; export default defineConfig({{ name:'boundaries' }});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{source}: {report}");
        let d = &report["diagnostics"][0];
        assert!(d["message"].as_str().unwrap().contains(message), "{source}: {report}");
        assert_eq!(d["location"]["file"], "typedpress.config.ts");
        assert!(!d["help"].as_str().unwrap().is_empty(), "{report}");
    }
}

#[test]
fn optional_chains_refuse_unguarded_continuations_at_source() {
    for expression in ["a?.b[n++]", "a?.b.c", "a?.b().c", "a?.b()()", "a?.b?.c[n++]"] {
        for javascript in [false, true] {
            let tmp = tempfile::tempdir().unwrap();
            let body = format!("const a=null;let n=0;try{{{expression};}}catch{{}}return n;");
            let handler = if javascript {
                write_app(
                    tmp.path().join("tp/helper.js"),
                    format!("export function probe(){{{body}}}"),
                )
                .unwrap();
                "probe".to_string()
            } else {
                format!("()=>{{{body}}}")
            };
            let import = if javascript {
                "import {probe} from './tp/helper.js';"
            } else {
                ""
            };
            std::fs::write(tmp.path().join("typedpress.config.ts"),format!("import {{defineConfig, mutation}} from 'typedpress';{import}const __probe = mutation({{}}, {handler}); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
            let (out, report) = checked(tmp.path());
            assert_eq!(out.status.code(), Some(1), "{expression}: {report}");
            let diagnostic = &report["diagnostics"][0];
            assert!(
                diagnostic["message"]
                    .as_str()
                    .unwrap()
                    .contains("continuation of an optional chain"),
                "{report}"
            );
            assert!(diagnostic["location"].is_object(), "{report}");
            assert!(
                diagnostic["help"]
                    .as_str()
                    .unwrap()
                    .contains("guard each nullable step"),
                "{report}"
            );
        }
    }
}

#[test]
fn missing_reads_cannot_satisfy_nullable_required_arguments() {
    for source in [
        "const a:number[]=[];f(a[0]);",
        "const a:[number]=[1];a.pop();f(a[0]);",
        "const a:Record<string,number>={};f(a.x);",
        "const a:Record<string,number>={};f(a['x']);",
        "const a:{x?:number}={};f(a.x);",
        "const a:{x?:number}={};f(a['x']);",
        "function g(a:{x:number}|null){f(a?.x);}g(null);",
        "function g(a:{x:number}|null){f(a?.['x']);}g(null);",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"),format!("import {{defineConfig, mutation}} from 'typedpress';const __probe = mutation({{}}, ()=>{{function f(v:number|null){{return typeof Number(v);}}{source}return 0;}}); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{source}: {report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(
            diagnostic["message"].as_str().unwrap().contains("function expects"),
            "{report}"
        );
        assert!(
            diagnostic["message"].as_str().unwrap().contains("undefined"),
            "{report}"
        );
        assert!(diagnostic["location"].is_object(), "{report}");
    }
}

#[test]
fn unsupported_native_properties_are_not_fabricated_as_undefined() {
    let tmp = tempfile::tempdir().unwrap();
    write_app(tmp.path().join("tp/helper.js"), "function read(value,key){try{return ['accepted',typeof value[key]];}catch(e){return [e.name,e.message];}}function get(value,key){return value[key];}export function probe(){const a=[];a.custom=2;return [read(new Set(),'union'),read([],'copyWithin'),typeof get({},'missing'),get(a,'custom'),typeof get('ab','flags')];}").unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress';import {probe} from './tp/helper.js';const __probe = mutation({}, ()=>probe()); export { __probe as probe }; export default defineConfig({ name:'nativeproperties' });").unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$s=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\\TypedPressApp\\'.$s['actions']['probe']['handler'];echo \TypedPress\Js::jsonStringify($fn(new \TypedPress\JsObject(), \TypedPress\Seam::ctx(['user'=>null])));"#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-nativeproperties/tp/app"),
        ],
    );
    assert_eq!(
        result,
        json!([
            ["TypeError", "Unsupported built-in set.union"],
            ["TypeError", "Unsupported built-in array.copyWithin"],
            "undefined",
            2,
            "undefined"
        ])
    );
}

#[test]
fn typed_data_reads_refuse_unmodeled_inherited_values() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), r#"
import {defineConfig, mutation} from 'typedpress';
const __probe = mutation({}, ()=>{
  const o:Record<string,undefined>={};
  const key='to'+'String';
  const optional:{toString?:undefined}={};
  const cases=[()=>typeof o.toString,()=>typeof o['valueOf'],()=>typeof o[key],()=>{const {toString}=o;return typeof toString;},()=>typeof optional.toString,()=>typeof optional['toString'],()=>{const n:Record<string,number>={};n.valueOf ||=1;return typeof 0;}];
  return cases.map(f=>{try{return ['accepted',f()];}catch(e){return [e.name,e.message];}});
}); export { __probe as probe }; export default defineConfig({ name:'typeddatareads' });
"#).unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$s=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\\TypedPressApp\\'.$s['actions']['probe']['handler'];echo \TypedPress\Js::jsonStringify($fn(new \TypedPress\JsObject(), \TypedPress\Seam::ctx(['user'=>null])));"#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-typeddatareads/tp/app"),
        ],
    );
    assert_eq!(
        result,
        json!(vec![
            vec![
                "TypeError",
                "Inherited properties are not supported by typed data reads"
            ];
            7
        ])
    );
}

#[test]
fn native_method_inventory_requires_an_accepted_or_refused_contract() {
    let node = Command::new("node").args(["-e", r#"
const owners={object:Object,array:Array,string:String,number:Number,boolean:Boolean,regex:RegExp,date:Date,set:Set,map:Map,function:Function,Math:{prototype:Math}};
const methods=Object.entries(owners).flatMap(([surface,owner])=>Object.entries(Object.getOwnPropertyDescriptors(owner.prototype)).filter(([name,descriptor])=>name!=='constructor'&&typeof descriptor.value==='function').map(([name])=>[surface,name]));
process.stdout.write(JSON.stringify(methods));
"#]).output().unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let methods: Vec<(String, String)> = serde_json::from_slice(&node.stdout).unwrap();
    assert!(methods.len() > 100, "unexpected native inventory: {}", methods.len());
    for (surface, name) in methods {
        assert!(
            typedpress::builtins::contract(&surface, &name).is_some(),
            "native {surface}.{name} needs an accepted or explicitly refused shared contract"
        );
    }
}

#[test]
fn parameter_default_scope_limits_are_located_refusals() {
    for source in [
        "const x=1;function f(a=()=>x){var x=2;return a();}f();",
        "const b=7;function f(a=b,b=1){return [a,b];}f();",
        "const a=7;function f(a=a){return a;}f();",
        "const x=1;function f({a=()=>x}={}){var x=2;return a();}f();",
        "const x=1;function f(a=()=>x){const x=2;return a();}f();",
        "const b=7;function f(a=()=>b,b=1){return a();}f();",
        "const b=7;function f(a=(()=>b)(),b=1){return a;}f();",
    ] {
        for javascript in [false, true] {
            let tmp = tempfile::tempdir().unwrap();
            let body = if javascript {
                write_app(
                    tmp.path().join("tp/helper.js"),
                    format!("export function probe(){{{source}return 0;}}"),
                )
                .unwrap();
                "import {probe} from './tp/helper.js';const __probe = mutation({}, ()=>probe()); export { __probe as probe }; export default defineConfig({});".to_string()
            } else {
                format!(
                    "{source}const __probe = mutation({{}}, ()=>0); export {{ __probe as probe }}; export default defineConfig({{}});"
                )
            };
            std::fs::write(
                tmp.path().join("typedpress.config.ts"),
                format!("import {{defineConfig}} from 'typedpress';{body}"),
            )
            .unwrap();
            let (out, report) = checked(tmp.path());
            assert_eq!(out.status.code(), Some(1), "{source}: {report}");
            let diagnostic = &report["diagnostics"][0];
            assert!(
                diagnostic["message"]
                    .as_str()
                    .unwrap()
                    .starts_with("parameter defaults"),
                "{report}"
            );
            assert!(diagnostic["location"].is_object(), "{report}");
            assert!(diagnostic["help"].as_str().unwrap().contains("pass"), "{report}");
        }
    }
}

#[test]
fn missing_string_compound_reads_do_not_fabricate_a_string_result_type() {
    for (declaration, access) in [
        ("const o:Record<string,string>={};", "o.x"),
        ("const o:Record<string,string>={};", "o['x']"),
        ("const o:string[]=[];", "o[0]"),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"),format!("import {{defineConfig, mutation}} from 'typedpress';const __probe = mutation({{}}, ()=>{{{declaration}const v=({access}+=1);return [String(v),`${{v}}`];}}); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(
            diagnostic["message"].as_str().unwrap().contains("ambiguous"),
            "{report}"
        );
        assert!(diagnostic["location"].is_object(), "{report}");
    }
}

#[test]
fn undefined_bindings_are_located_refusals_in_all_runtime_binding_forms() {
    for source in [
        "function f(undefined){return String(undefined);}f(3);",
        "const undefined=3;String(undefined);",
        "const {a:undefined}={a:3};String(undefined);",
        "const {...undefined}={a:3};String(undefined);",
        "const [...undefined]=[3];String(undefined);",
        "function f(...undefined){return String(undefined);}f(3);",
        "try{throw 3;}catch(undefined){String(undefined);}",
        "for(const undefined in {a:3}){String(undefined);}",
        "for(const undefined of [3]){String(undefined);}",
        "function undefined(){return 3;}undefined();",
        "class undefined{};new undefined();",
        "import {n as undefined} from './tp/binding-helper.js';String(undefined);",
        "import undefined from './tp/binding-helper.js';String(undefined);",
        "import * as undefined from './tp/binding-helper.js';String(undefined);",
    ] {
        for javascript in [false, true] {
            let tmp = tempfile::tempdir().unwrap();
            write_app(
                tmp.path().join("tp/binding-helper.js"),
                "export const n=3;export default 3;",
            )
            .unwrap();
            let body = if javascript {
                write_app(
                    tmp.path().join("tp/binding-probe.js"),
                    format!("{source}export function probe(){{return 0;}}"),
                )
                .unwrap();
                "import {probe} from './tp/binding-probe.js';const __probe = mutation({}, ()=>probe()); export { __probe as probe }; export default defineConfig({});".to_string()
            } else {
                format!(
                    "{source}const __probe = mutation({{}}, ()=>0); export {{ __probe as probe }}; export default defineConfig({{}});"
                )
            };
            std::fs::write(
                tmp.path().join("typedpress.config.ts"),
                format!("import {{defineConfig}} from 'typedpress';{body}"),
            )
            .unwrap();
            let (out, report) = checked(tmp.path());
            assert_eq!(out.status.code(), Some(1), "{source}: {report}");
            let diagnostic = &report["diagnostics"][0];
            if source.starts_with("class undefined") && !javascript {
                assert!(
                    diagnostic["message"].as_str().unwrap().contains("Class name cannot be"),
                    "{report}"
                );
            } else {
                assert!(
                    diagnostic["message"]
                        .as_str()
                        .unwrap()
                        .contains("bindings named `undefined`"),
                    "{source}: {report}"
                );
                assert!(
                    diagnostic["help"].as_str().unwrap().contains("different name"),
                    "{report}"
                );
            }
            assert!(diagnostic["location"].is_object(), "{report}");
        }
    }
}

#[test]
fn deferred_lexical_captures_and_missing_required_callback_slots_are_located_refusals() {
    for (source, message) in [
        (
            "const x=1;function foo(){const f=()=>x;const x=2;return f();}return foo();",
            "before its lexical declaration",
        ),
        (
            "const x=1;{const f=()=>x;const {x}={x:2};return f();}",
            "before its lexical declaration",
        ),
        (
            "function cb(x:number,i:number,a:number[],missing:null){return String(missing);}return [1].map(cb);",
            "never supplies required parameter 4",
        ),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"),format!("import {{defineConfig, mutation}} from 'typedpress';const __probe = mutation({{}}, ()=>{{{source}}}); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(diagnostic["message"].as_str().unwrap().contains(message), "{report}");
        assert!(diagnostic["location"].is_object(), "{report}");
        assert!(
            diagnostic["help"].as_str().is_some_and(|help| !help.is_empty()),
            "{report}"
        );
    }
}

#[test]
fn lexical_initialization_refusals_cover_loop_sources_reads_and_assignments() {
    for body in [
        "const x=7;for(const x of [x])return x;return 0;",
        "const x=5;for(const [x=x] of [[undefined]])return x;return 0;",
        "const x=5;for(let [x=x] of [[undefined]])return x;return 0;",
        "const b=5;const rows:{a?:number;b:number}[]=[{b:1}];for(const {a=b,b} of rows)return a;return 0;",
        "const x='key';for(const x in {[x]:1})return x;return '';",
        "let x=7;for(let x of [(x=2)])return x;return 0;",
        "const x=7;for(const x of [()=>x])return x();return 0;",
        "const x=7;for(let x=x;false;){}return x;",
        "const x=7;{const y=x;let x=2;return y;}",
        "let x=7;{x=2;let x=3;return x;}",
    ] {
        for handler in [false, true] {
            let tmp = tempfile::tempdir().unwrap();
            let (declaration, result) = if handler {
                (String::new(), format!("(()=>{{{body}}})()"))
            } else {
                (format!("const folded=(()=>{{{body}}})();"), "folded".into())
            };
            std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';{declaration}const __probe = mutation({{}}, ()=>{result}); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
            let (out, report) = checked(tmp.path());
            assert_eq!(out.status.code(), Some(1), "{body}, handler={handler}: {report}");
            let diagnostic = &report["diagnostics"][0];
            let message = if handler {
                "before its lexical declaration"
            } else {
                "isn't initialized"
            };
            assert!(diagnostic["message"].as_str().unwrap().contains(message), "{report}");
            assert!(diagnostic["location"].is_object(), "{report}");
            assert!(
                diagnostic["help"].as_str().is_some_and(|help| !help.is_empty()),
                "{report}"
            );
        }
    }
}

#[test]
fn error_options_refuse_inherited_causes_in_typed_and_checked_javascript() {
    let tmp = tempfile::tempdir().unwrap();
    write_app(tmp.path().join("tp/helper.js"), "class Base {cause(){}} class Options extends Base {} export function read(){try{return Object.hasOwn(new Error('x',new Options()),'cause');}catch(e){return [e.name,e.message];}}").unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress';import {read} from './tp/helper.js';class Base {cause(){}} class Options extends Base {} const __test = mutation({}, ()=>{let typed:string[]=[];try{Object.hasOwn(new Error('x',new Options()),'cause');}catch(e){typed=[e.name,e.message];}return [typed,read()];}); export { __test as test }; export default defineConfig({ name:'errorcause' });").unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/typedpress-app-errorcause/tp/app");
    let actual = php(
        r#"
        require $argv[1];
        require $argv[2] . '/functions.php';
        echo \TypedPress\Js::jsonStringify(\TypedPressApp\action__test());
    "#,
        &[&content.join("plugins/typedpress-runtime/tp/bootstrap.php"), &app],
    );
    assert_eq!(
        actual,
        json!([
            ["TypeError", "Error cause is not supported"],
            ["TypeError", "Error cause is not supported"]
        ])
    );
}

#[test]
fn writes_to_named_exports_refuse_before_importers_can_go_stale() {
    for (file, source, import) in [
        (
            "tp/counter.js",
            "export let value=0;export function inc(){value++;}",
            "import {value,inc} from './tp/counter.js';",
        ),
        (
            "tp/counter.ts",
            "let counter=0;export {counter as value};export function inc(){counter++;}",
            "import {value,inc} from './tp/counter.ts';",
        ),
        (
            "tp/counter.js",
            "export var value=0;export function inc(){value++;}",
            "import * as counter from './tp/counter.js';const {value,inc}=counter;",
        ),
        (
            "tp/counter.js",
            "let value=0;export {value as default};export function inc(){value++;}",
            "import value,{inc} from './tp/counter.js';",
        ),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        write_app(tmp.path().join(file), source).unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';{import}inc();const folded=value;const __probe = mutation({{}}, ()=>folded); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let diagnostic = &report["diagnostics"][0];
        assert_eq!(
            diagnostic["message"], "reassigning named exports isn't supported",
            "{report}"
        );
        assert_eq!(diagnostic["location"]["file"], file, "{report}");
        assert!(
            diagnostic["help"].as_str().is_some_and(|help| help.contains("const")),
            "{report}"
        );
    }
}

#[test]
fn typed_array_calls_refuse_own_overrides_installed_by_javascript() {
    let tmp = tempfile::tempdir().unwrap();
    write_app(
        tmp.path().join("tp/array-overrides.js"),
        "export function installArrayOverrides(a,b){a.map=()=>[99];b.join=()=>'own';}",
    )
    .unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress';import {installArrayOverrides} from './tp/array-overrides.js';const __test = mutation({}, ()=>{const a=[1,2],b=[1,2];installArrayOverrides(a,b);let mapped:string[]=[];let joined:string[]=[];try{a.map(x=>x+1);}catch(e){mapped=[e.name,e.message];}try{b.join('-');}catch(e){joined=[e.name,e.message];}return [mapped,joined];}); export { __test as test }; export default defineConfig({ name:'arraynative' });").unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/typedpress-app-arraynative/tp/app");
    let actual = php(
        r#"
        require $argv[1];
        require $argv[2] . '/functions.php';
        echo \TypedPress\Js::jsonStringify(\TypedPressApp\action__test());
    "#,
        &[&content.join("plugins/typedpress-runtime/tp/bootstrap.php"), &app],
    );
    assert_eq!(
        actual,
        json!([
            [
                "TypeError",
                "Own array method overrides are not supported by typed calls"
            ],
            [
                "TypeError",
                "Own array method overrides are not supported by typed calls"
            ]
        ])
    );
}

#[test]
fn configuration_evaluation_refuses_destructured_var_loops_like_handlers() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress';const folded=(()=>{for(var [x] of [[1]])return x;return 0;})();const __probe = mutation({}, ()=>folded); export { __probe as probe }; export default defineConfig({});").unwrap();
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1), "{report}");
    let diagnostic = &report["diagnostics"][0];
    assert_eq!(
        diagnostic["message"], "destructured var loops aren't supported yet",
        "{report}"
    );
    assert_eq!(diagnostic["location"]["file"], "typedpress.config.ts", "{report}");
    assert_eq!(
        diagnostic["help"], "use const or let for loop destructuring",
        "{report}"
    );
}

#[test]
fn named_function_expressions_bind_their_name_inside_themselves() {
    // The inner name shadows an outer binding of the same name, at build time and in a handler.
    for declaration in [
        "const x=7;const folded=(function x(){return typeof x;})();",
        "const x=7;const folded=()=> (function x(){return typeof x;})();",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';{declaration}const __probe = mutation({{}}, ()=>folded); export {{ __probe as probe }}; export default defineConfig({{}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(0), "{declaration}: {report}");
    }
    // Strict JavaScript throws on a write to the name, so it is refused where it is written.
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress';\nconst f=function g(){ g = () => 1; return 1; };\nconst __probe = mutation({}, ()=>f()); export { __probe as probe }; export default defineConfig({});").unwrap();
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1), "{report}");
    let diagnostic = &report["diagnostics"][0];
    assert!(
        diagnostic["message"]
            .as_str()
            .unwrap()
            .contains("assigning to a named function expression's own name"),
        "{report}"
    );
    assert_eq!(diagnostic["location"]["line"], 2, "{report}");
    assert!(
        diagnostic["help"].as_str().unwrap().contains("local variable"),
        "{report}"
    );
    // A parameter default runs where the name is still the function, so writing it is refused too.
    let tmp = tempfile::tempdir().unwrap();
    write_app(
        tmp.path().join("tp/h.mjs"),
        "export const run = () => { const fn = function f(x = (f = () => 1)) { return x; }; return fn(); };\n",
    )
    .unwrap();
    std::fs::write(tmp.path().join("typedpress.config.ts"), "import {defineConfig, mutation} from 'typedpress';\nimport { run } from './tp/h.mjs';\nconst __probe = mutation({}, ()=>run()); export { __probe as probe }; export default defineConfig({});").unwrap();
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1), "{report}");
    assert!(
        report["diagnostics"][0]["message"]
            .as_str()
            .unwrap()
            .contains("own name"),
        "{report}"
    );
}

/// `abilities.call` from "php/wordpress": a locked ability and the app's own action are typed for the
/// compiler and for tsc (tp/_generated/db.d.ts), and the compiled handler calls `Call::run` with the input as
/// a JS value, using the typed result. `Call::run` itself runs on WordPress in tests/php/abilities_test.php.
#[test]
fn wordpress_abilities_are_typed_from_the_lock_and_the_schema() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("calls");
    copy_dir(&root().join("tests/fixtures/abilities-call"), &project);
    let content = build_wp(&project);
    let plugin = content.join("plugins/typedpress-app-calls/tp/app/functions.php");
    // Stand in for WordPress: record each call and answer as the ability would.
    let stub = tmp.path().join("call.php");
    std::fs::write(
        &stub,
        r#"<?php
        namespace TypedPress\Wp\Abilities;
        final class Call {
            public static array $seen = [];
            public static function run(string $name, mixed $input): mixed {
                self::$seen[] = [$name, \TypedPress\Js::jsonStringify($input)];
                return $name === 'acme/site-info' ? new \TypedPress\JsObject(['value' => 'first site']) : 'hi ada';
            }
        }"#,
    )
    .unwrap();
    let got = php(
        r#"
        require $argv[1]; require $argv[2]; require $argv[3];
        $out = \TypedPressApp\action__relay(new \TypedPress\JsObject(['who' => 'ada']), null);
        echo json_encode(['out' => \TypedPress\Js::jsonTree($out), 'seen' => \TypedPress\Wp\Abilities\Call::$seen]);
    "#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &stub,
            &plugin,
        ],
    );
    assert_eq!(
        got,
        json!({"out": {"name": "FIRST SITE", "own": "hi ada"},
            "seen": [["acme/site-info", "{\"field\":\"name\"}"], ["calls/greet", "{\"who\":\"ada\"}"]]})
    );
    std::fs::write(
        project.join("tsconfig.json"),
        serde_json::to_vec(&json!({
            "compilerOptions": {
                "strict": true, "noEmit": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "types": [],
                "paths": { "typedpress": [root().join("types/typedpress/index.d.ts")], "php/wordpress": [root().join("types/typedpress/wordpress.d.ts")] }
            },
            "files": ["typedpress.config.ts", "tp/_generated/db.d.ts"]
        }))
        .unwrap(),
    )
    .unwrap();
    let tsc = || {
        Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
            .arg("--project")
            .arg(project.join("tsconfig.json"))
            .output()
            .expect("tsc (or TSC) must be installed")
    };
    let out = tsc();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    // tsc refuses the same wrong input the compiler refuses.
    let config = std::fs::read_to_string(project.join("typedpress.config.ts")).unwrap();
    std::fs::write(
        project.join("typedpress.config.ts"),
        config.replace("field: \"name\"", "field: \"title\""),
    )
    .unwrap();
    let out = tsc();
    assert!(
        String::from_utf8_lossy(&out.stdout)
            .contains("Type '\"title\"' is not assignable to type '\"name\" | \"url\"'")
    );
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &to.join(entry.file_name()));
        } else {
            std::fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
        }
    }
}

/// An app with no registries in `defineConfig` (docs/spec/spec.md §1.1): `notes` and `like` register
/// from their exports under `tp/`, `like` reaches `notes` through `"typedpress:db"`, and on an
/// in-process WordPress the action's write lands in the table the export declared.
#[test]
fn exported_kinds_and_actions_register_by_name_and_run() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("exports");
    copy_dir(&root().join("tests/fixtures/exports"), &project);
    let content = build_wp(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("eval")
        .arg(&content)
        .arg(
            r#"
            $row = $app->db->insert('notes', ['title' => 'TypedPress'], true)[0];
            $first = $wp->call('POST', '/actions/like', ['id' => $row['id']]);
            $second = $wp->call('POST', '/actions/like', ['id' => $row['id']]);
            $stored = $app->db->findFirst('notes', ['where' => ['id' => $row['id']]]);
            echo json_encode([$first[0], $first[1], $second[1], $stored['likes']]), "
";
            "#,
        )
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    let got: Value = serde_json::from_str(text.lines().next_back().unwrap()).unwrap();
    assert_eq!(got, json!([200, 1, 2, 2]));
}

/// `wp-hooks/` on an in-process WordPress, through the built plugin: one hook's files apply in
/// file-name order, a `priority` export moves one, a throwing filter hands back its input, and an
/// action reads the typed WP_Post view (its throw is logged, the save goes on).
#[test]
fn wp_hooks_register_in_file_order_with_their_priorities() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("hooks");
    copy_dir(&root().join("tests/fixtures/wp-hooks"), &project);
    let content = build_wp(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("eval")
        .arg(&content)
        .arg(
            r#"
            $log = tempnam(sys_get_temp_dir(), 'typedpress-hooks');
            ini_set('error_log', $log);
            $content = apply_filters('the_content', "  body  ");
            $title = apply_filters('the_title', 'Kept', 7);
            $id = wp_insert_post(['post_title' => 'Draft one', 'post_status' => 'draft', 'post_type' => 'post']);
            $errors = array_values(array_filter(explode("\n", (string) file_get_contents($log)), fn ($l) => str_contains($l, 'wp-hooks/')));
            echo json_encode(['content' => $content, 'title' => $title, 'saved' => $id > 0,
                'errors' => array_map(fn ($l) => preg_replace('/^\[[^\]]*\] /', '', $l), $errors)]), "\n";
            "#,
        )
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    let got: Value = serde_json::from_str(text.lines().next_back().unwrap()).unwrap();
    assert_eq!(
        got,
        json!({
            // c-early trims at 5, core's wpautop (also at 10, registered first) wraps, then a, then b.
            "content": "<div><p>body</p>\n[a]</div>",
            "title": "Kept",
            "saved": true,
            "errors": [
                "[typedpress] tp/wp-hooks/the_title: TypedPress\\JsError: broken title filter",
                "[typedpress] tp/wp-hooks/save_post: TypedPress\\JsError: saw Draft one #true",
            ],
        })
    );
}

/// WordPress functions from "php/wordpress" on an in-process WordPress, through the built plugin:
/// the action runs as the signed-in user, writes an option and a post, reads the post back as a
/// typed view, and a WP_Error from wp_insert_post is a thrown HttpError.
#[test]
fn wordpress_functions_run_as_the_signed_in_user() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("fns");
    copy_dir(&root().join("tests/fixtures/wp-functions"), &project);
    let content = build_wp(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("eval")
        .arg(&content)
        .arg(
            r#"
            $run = function (string $title, ?string $as) use ($wp) {
                [$status, $data] = $wp->call('POST', '/actions/note', ['title' => $title], $as);
                return [$status, $data];
            };
            echo json_encode([
                'editor' => $run('Fish & <chips>', 'editor'),
                'subscriber' => $run('Nope', 'subscriber'),
                'empty' => $run('', 'editor'),
                'option' => get_option('fns_last_note'),
            ]), "\n";
            "#,
        )
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    let got: Value = serde_json::from_str(text.lines().next_back().unwrap()).unwrap();
    let editor = &got["editor"][1];
    assert_eq!(got["editor"][0], 200, "{got}");
    assert_eq!(editor["allowed"], true);
    assert!(editor["id"].as_i64().unwrap() > 0);
    assert_eq!(editor["title"], "Fish &amp; &lt;chips&gt;");
    assert_eq!(editor["last"], "Fish & <chips>");
    // `get_userdata` and `get_permalink` answer "or false"; both were narrowed to their values.
    assert_eq!(editor["author"], "editor");
    assert_eq!(editor["linked"], true);
    assert_eq!(got["subscriber"], json!([200, {"allowed": false}]));
    // An empty post is WordPress's `empty_content` WP_Error: 422 with its code; the option written
    // before it rolled back with the action's transaction.
    assert_eq!(got["empty"][0], 422);
    assert_eq!(got["empty"][1]["code"], "empty_content");
    assert_eq!(got["option"], "Fish & <chips>");
}

/// The compiler's own-app ability types and the runtime's registered abilities come from the same
/// schema; this runs both and compares names, input properties and required inputs, so a new
/// operation in runtime/TypedPress/Wp/Abilities/Register.php can't go untyped.
#[test]
fn wordpress_own_abilities_match_the_registered_ones() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("own");
    copy_dir(&root().join("tests/fixtures/abilities-own"), &project);
    let content = build_wp(&project);
    let program = typedpress::loader::load(&project.join("typedpress.config.ts")).unwrap();
    let built = typedpress::pipeline::build(
        &project,
        &program,
        || Ok(typedpress::pipeline::Previous::none()),
        |_| None,
    )
    .unwrap();
    let compiled: Value = serde_json::to_value(typedpress::wordpress::abilities::own_inputs(&built.schema)).unwrap();
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("eval")
        .arg(&content)
        .arg(
            r#"
            $out = [];
            foreach (\TypedPress\Wp\Abilities\Register::operations() as $op) {
                $keys = array_map('strval', array_keys($op['input']['properties'] ?? []));
                $required = array_map('strval', $op['input']['required'] ?? []);
                sort($keys);
                sort($required);
                $out[$op['name']] = [$keys, $required];
            }
            ksort($out);
            echo json_encode($out), "\n";
            "#,
        )
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let registered: Value =
        serde_json::from_str(String::from_utf8_lossy(&out.stdout).lines().next_back().unwrap()).unwrap();
    // Both include `-revisions`, the sync trio, the auth create's `password` and the agent job.
    assert!(
        registered["own/notes-revisions"].is_array()
            && registered["own/members-create"][0].to_string().contains("password")
    );
    assert_eq!(compiled, registered);
}

/// Language constructs live Zero 0.8 apps use (first#138). Each `tests/differential/language/*.ts`
/// is an app whose every action gives byte-identical JSON under Node and as compiled PHP. Files
/// beside it (untyped `.mjs` helpers) are copied with it.
/// A helper, class, namespace receiver or captured collection that TypedPress refuses is reported
/// wherever it is first compiled: in a sibling method that reads `this`, in an `if`, a ternary or
/// a `for await` array, or behind an `instanceof` check. The checks that type a branch never leave
/// it registered without code, so the build never calls a function PHP never got.
#[test]
fn a_refusal_inside_a_helper_or_class_is_reported_wherever_it_is_first_compiled() {
    let first = "function first(xs: number[]): number { return xs[0]! + 'a'.localeCompare('b'); }";
    let boxed = "class Box { constructor(public v: number) {} top(xs: number[]): number { return xs[0]! + 'a'.localeCompare('b') + this.v; } }";
    let refused = "localeCompare() isn't supported";
    for (declarations, handler, message) in [
        (
            first,
            "() => ({ a() { return first([1, 3, 2]) + this.b(); }, b() { return this.n; }, n: 1 }).a()",
            refused,
        ),
        (
            boxed,
            "() => ({ a() { return new Box(1).top([1, 3, 2]) + this.b(); }, b() { return this.n; }, n: 1 }).a()",
            refused,
        ),
        (first, "() => { if (first([1, 3, 2])) return 1; return 0; }", refused),
        (
            first,
            "async () => { let n = 0; for await (const v of [first([1, 3, 2])]) n += v; return n; }",
            refused,
        ),
        (first, "() => (first([1, 3, 2]) ? 1 : 0)", refused),
        (
            first,
            "() => ({ a() { if (first([1, 3, 2])) return this.n; return 0; }, n: 1 }).a()",
            refused,
        ),
        (
            boxed,
            "() => { const u: unknown = JSON.parse(\"1\"); if (u instanceof Box) return 1; return 0; }",
            refused,
        ),
        (
            format!("{boxed} function h(): number {{ return new Box(1).v; }}").as_str(),
            "() => { if (h()) return 1; return 0; }",
            refused,
        ),
        (
            "function bad(): number { return 'a'.localeCompare('b'); } const ns = { n: 1, get(this: { n: number }): number { return this.n; }, bad };",
            "() => { if (ns.get()) return 1; return 0; }",
            refused,
        ),
        (
            "const m = new Map([[\"a\", () => 1]]);",
            "() => { if (m.get(\"a\")) return 1; return 0; }",
            "captured data contains a function, which can't be used in PHP",
        ),
        // A module-level literal whose method reads `this` is built whole in PHP, so a member the
        // method never reads is still compiled, and its refusal is reported, not dropped.
        (
            "class K { m(xs: number[]): number { return xs[0]! + 'a'.localeCompare('b'); } } const api = { K, n: 1, f() { return this.n; } };",
            "() => [api.f(), new K().m([1, 3, 2])]",
            refused,
        ),
        (
            "const api = { m: new Map([[1, () => 2]]), n: 1, f() { return this.n; } };",
            "() => api.f()",
            "captured data contains a function, which can't be used in PHP",
        ),
        (
            "class Box { constructor(public v: number) {} m(): number { return h().v; } ok(): boolean { return true; } top(xs: number[]): number { return xs[0]! + 'a'.localeCompare('b'); } } function h(): Box { return new Box(1); }",
            "() => { const u: unknown = JSON.parse(\"1\"); if (u instanceof Box && h().ok()) return 1; return 0; }",
            refused,
        ),
        (
            "class Box { constructor(public v: number) {} m(): number { return new Tag().of(this); } ok(): boolean { return true; } top(xs: number[]): number { return xs[0]! + 'a'.localeCompare('b'); } } class Tag { of(b: Box): number { return b.v; } box(): Box | null { return null; } } function t(): Tag { return new Tag(); }",
            "() => { const u: unknown = JSON.parse(\"1\"); if (u instanceof Box && t().box()!.ok()) return 1; return 0; }",
            refused,
        ),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("typedpress.config.ts"),
            format!("import {{ defineConfig, mutation }} from 'typedpress';\n{declarations}\nconst __probe = mutation({{}}, {handler}); export {{ __probe as probe }}; export default defineConfig({{}});\n"),
        )
        .unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{handler}: {report}");
        assert!(
            report["diagnostics"][0]["message"].as_str().unwrap().contains(message),
            "{handler}: {report}"
        );
    }
}

/// An object literal's method that reads `this` is typed after the other properties, so a later
/// property or spread with its key must win: calling the replaced method is refused, as Node
/// would throw.
#[test]
fn a_method_replaced_by_a_later_property_is_not_callable() {
    for body in [
        "({ f() { return this.x; }, ...{ f: 1 }, x: 1 }).f()",
        "({ f() { return this.x; }, f: 1, x: 1 }).f()",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("typedpress.config.ts"),
            format!("import {{ defineConfig, mutation }} from 'typedpress';\nconst __probe = mutation({{}}, () => {body}); export {{ __probe as probe }}; export default defineConfig({{}});\n"),
        )
        .unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{body}: {report}");
        assert_eq!(
            report["diagnostics"][0]["message"], "number isn't a function",
            "{body}: {report}"
        );
    }
}

#[test]
fn compiler_followups_preserve_spread_receivers_and_class_narrowing_in_php() {
    let cases = [
        (
            "function maybeA(present: boolean): { a?: number } { return present ? { a: 7 } : {}; }",
            "{ const absent = { a: 's', ...maybeA(false) }; const present = { a: 's', ...maybeA(true) }; return [Number(absent.a ?? 0), Number(present.a ?? 0)]; }",
            json!([null, 7]),
        ),
        (
            "function maybeF(present: boolean): { f?: () => number } { return present ? { f: () => 9 } : {}; }",
            "{ const absent: { n: number; f: (() => number) | undefined } = { n: 2, f() { return this.n; }, ...maybeF(false) }; const present = { n: 2, f() { return this.n; }, ...maybeF(true) }; const f = absent.f; const g = present.f; return [f ? f.call(absent) : 0, g ? g() : 0]; }",
            json!([2, 9]),
        ),
        (
            "class Box { constructor(public n: number) {} top(): number { return makeBox().n; } } function makeBox(): Box { return new Box(4); }",
            "{ const value = makeBox().top(); const u: unknown = new Box(4); const both = u instanceof Box && u.top() === value; if (u instanceof Box) return [value, both, u.top()]; return []; }",
            json!([4, true, 4]),
        ),
        (
            "const captured = { a() { const self = this; return self.n; }, b() { return this.a(); }, c() { const self = this; return self.a(); }, n: 3 };",
            "{ const inline = { a() { const self = this; return self.n; }, b() { return this.a(); }, c() { const self = this; return self.a(); }, n: 4 }; return [captured.a(), captured.b(), captured.c(), inline.a(), inline.b(), inline.c()]; }",
            json!([3, 3, 3, 4, 4, 4]),
        ),
    ];
    let project = tempfile::tempdir().unwrap();
    let mut source = String::from("import { defineConfig, mutation } from 'typedpress';\n");
    let mut expected = serde_json::Map::new();
    for (i, (declarations, body, result)) in cases.into_iter().enumerate() {
        source.push_str(&format!(
            "{declarations}\nexport const p{i} = mutation({{}}, () => {body});\n"
        ));
        expected.insert(format!("p{i}"), result);
    }
    for (i, (body, result)) in [
        (r#"return this["b"]();"#, json!(3)),
        (r#"return this?.["b"]();"#, json!(3)),
        ("const { b } = this; return b();", json!("undefined")),
        ("const self = this; return self.b();", json!(3)),
    ]
    .into_iter()
    .enumerate()
    {
        let sibling = if i == 2 {
            "return typeof this;"
        } else {
            "return this.n;"
        };
        let literal = format!("{{ a() {{ {body} }}, b() {{ {sibling} }}, n: 3 }}");
        source.push_str(&format!(
            "const api{i} = {literal};\nexport const receiver{i} = mutation({{}}, () => [api{i}.a(), ({literal}).a()]);\n"
        ));
        expected.insert(format!("receiver{i}"), json!([result, result]));
    }
    source.push_str("export default defineConfig({ name: 'compiler-followups' });\n");
    std::fs::write(project.path().join("typedpress.config.ts"), source).unwrap();
    let content = build_wp(project.path());
    let actual = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $out = [];
        foreach ($schema['actions'] as $name => $action) {
            $fn = '\\TypedPressApp\\' . $action['handler'];
            $out[$name] = $fn(new \TypedPress\JsObject(), \TypedPress\Seam::ctx(['user' => null]));
        }
        echo \TypedPress\Js::jsonStringify(new \TypedPress\JsObject($out));
        "#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-compiler-followups/tp/app"),
        ],
    );
    assert_eq!(actual, Value::Object(expected));
}

#[test]
fn commonjs_whole_receiver_refusal_uses_the_source_name() {
    let project = tempfile::tempdir().unwrap();
    write_app(
        project.path().join("tp/api.cjs"),
        "exports.v = 1; exports.get = () => this;",
    )
    .unwrap();
    std::fs::write(
        project.path().join("typedpress.config.ts"),
        "import { defineConfig, mutation } from 'typedpress'; import api from './tp/api.cjs'; export const probe = mutation({}, () => api.get()); export default defineConfig({});",
    )
    .unwrap();
    let (out, report) = checked(project.path());
    assert_eq!(out.status.code(), Some(1), "{report}");
    let diagnostic = &report["diagnostics"][0];
    assert!(
        diagnostic["message"]
            .as_str()
            .unwrap()
            .starts_with("`this` holds functions"),
        "{diagnostic}"
    );
    assert!(
        diagnostic["help"].as_str().unwrap().contains("`this.get(...)`"),
        "{diagnostic}"
    );
    assert!(!report.to_string().contains("%commonjs-this"), "{report}");
}

#[test]
fn language_constructs_match_node_through_generated_php() {
    let dir = root().join("tests/differential/language");
    let mut apps: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "ts"))
        .collect();
    apps.sort();
    assert!(!apps.is_empty());
    for config in apps {
        let name = config.file_stem().unwrap().to_str().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        // The helper modules beside it, not the other cases: every module under tp/ registers
        // its exported actions (spec §1.1), so another case's file would add its actions here.
        let siblings: Vec<PathBuf> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| *path != config && path.extension().is_none_or(|ext| ext != "ts"))
            .collect();
        project_from(
            tmp.path(),
            &config,
            &siblings.iter().map(PathBuf::as_path).collect::<Vec<_>>(),
        );
        let node = Command::new("node")
            .arg(root().join("tests/differential/run-node.mjs"))
            .arg(&config)
            .output()
            .unwrap();
        assert!(
            node.status.success(),
            "{name}: {}",
            String::from_utf8_lossy(&node.stderr)
        );
        let node = String::from_utf8(node.stdout).unwrap();
        let expected: Value = serde_json::from_str(&node).unwrap();
        assert_eq!(expected["complete"], true);
        let cases = expected["cases"].as_object().unwrap();
        assert!(
            cases.values().all(|result| result.get("data").is_some()),
            "{name}: {expected}"
        );
        let content = build_wp(tmp.path());
        let runtime = content.join("plugins/typedpress-runtime/tp/bootstrap.php");
        let app = content.join(format!("plugins/typedpress-app-language-{name}/tp/app"));
        let out = Command::new("php")
            .arg("-r")
            .arg(
                r#"
            require $argv[1];
            $schema = require $argv[2] . '/schema.php';
            require $argv[2] . '/functions.php';
            $out = [];
            foreach ($schema['actions'] as $name => $action) {
                $fn = '\\TypedPressApp\\' . $action['handler'];
                try { $out[$name] = ['data' => \TypedPress\Seam::toWire($fn(new \TypedPress\JsObject()))]; }
                catch (\Throwable $e) { $out[$name] = ['error' => $e->getMessage()]; }
            }
            // Node lists a module's exports in name order (run-node.mjs reads them from the module).
            ksort($out, SORT_STRING);
            echo \TypedPress\Js::jsonStringify(['schema' => 'typedpress-differential', 'version' => 1, 'complete' => true, 'cases' => $out]);
        "#,
            )
            .arg(&runtime)
            .arg(&app)
            .output()
            .unwrap();
        assert!(out.status.success(), "{name}: {}", String::from_utf8_lossy(&out.stderr));
        assert!(
            out.stderr.is_empty(),
            "{name}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let php = String::from_utf8(out.stdout).unwrap();
        let actual: Value = serde_json::from_str(&php).unwrap();
        for (case, want) in cases {
            assert_eq!(
                &actual["cases"][case], want,
                "{name}/{case}: compiled PHP differs from Node"
            );
        }
        assert_eq!(php, node, "{name}: the PHP envelope is not byte-identical to Node's");
    }
}

/// `process.platform` and `navigator.platform` are read when PHP runs, never decided on the build
/// machine: two builds of tests/differential/language/host-platform.ts emit the same PHP, and that
/// PHP answers with whatever `TypedPress\Host` reports on the server. A stand-in `TypedPress\Host` for a
/// Windows and a macOS server makes picomatch's `isWindows` flip without rebuilding.
#[test]
fn host_platform_is_read_on_the_server_not_the_build_machine() {
    let dir = root().join("tests/differential/language");
    let config = dir.join("host-platform.ts");
    let helpers = dir.join("host-platform-helpers.mjs");
    let builds: Vec<_> = (0..2)
        .map(|_| {
            let tmp = tempfile::tempdir().unwrap();
            project_from(tmp.path(), &config, &[helpers.as_path()]);
            let content = build_wp(tmp.path());
            let app = content.join("plugins/typedpress-app-language-host-platform/tp/app");
            let functions = std::fs::read(app.join("functions.php")).unwrap();
            (tmp, content, app, functions)
        })
        .collect();
    assert_eq!(builds[0].3, builds[1].3, "two builds emitted different PHP");
    let (_, content, app, _) = &builds[0];
    let runtime = content.join("plugins/typedpress-runtime/tp/bootstrap.php");
    let script = r#"
        namespace TypedPress { final class Host {
            public static function platform(): string { return getenv('FAKE_PLATFORM'); }
            public static function navigatorPlatform(): string { return getenv('FAKE_NAVIGATOR'); }
        } }
        namespace {
            require $argv[1];
            $schema = require $argv[2] . '/schema.php';
            require $argv[2] . '/functions.php';
            $out = [];
            foreach (['picomatch', 'platforms', 'typedPlatforms'] as $name) {
                $fn = '\\TypedPressApp\\' . $schema['actions'][$name]['handler'];
                $out[$name] = \TypedPress\Seam::toWire($fn(new \TypedPress\JsObject()));
            }
            echo json_encode($out);
        }
    "#;
    for (platform, navigator, windows) in [("win32", "Win32", true), ("darwin", "MacIntel", false)] {
        let out = Command::new("php")
            .args(["-r", script])
            .arg(&runtime)
            .arg(app)
            .env("FAKE_PLATFORM", platform)
            .env("FAKE_NAVIGATOR", navigator)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        let got: Value = serde_json::from_slice(&out.stdout).unwrap();
        assert_eq!(
            got,
            serde_json::json!({
                "picomatch": { "isWindows": windows, "type": "boolean" },
                "platforms": { "navigator": navigator, "process": platform },
                "typedPlatforms": { "navigator": navigator, "process": platform, "windows": windows },
            }),
            "{platform}"
        );
    }
}

/// Twelve objects that point at each other through six fields, then twelve member writes through
/// them. Every write reaches every object below every short field path, and alias expansion
/// within one pass once grew an event's place set to millions of places before the end-of-pass
/// widening check could see it: on this program the previous solver took more than 90 s and
/// 2.9 GB in a debug build. The solver now numbers each place once and widens a binding whose group
/// runs away inside a pass (docs/decisions/2026-11-12-effects-event-scale.md). Debug builds count
/// path projections (`TP_DEBUG_EFFECTS_WORK`); the solve must stay a small multiple of its
/// result, widen the same bindings on every run, and the PHP must compute what Node computes.
#[test]
fn effects_on_an_object_graph_stay_bounded_and_keep_php_equal_to_node() {
    let tmp = tempfile::tempdir().unwrap();
    let nodes = 12;
    let fields = ["a", "b", "c", "d", "e", "f"];
    let mut body = String::from("export function run(input) {\n  const nodes = [];\n");
    for i in 0..nodes {
        body.push_str(&format!(
            "  const n{i} = {{ id: {i}, label: input }};\n  nodes.push(n{i});\n"
        ));
    }
    for i in 0..nodes {
        for (j, field) in fields.iter().enumerate() {
            body.push_str(&format!("  n{i}.{field} = n{};\n", (i * 3 + j + 1) % nodes));
        }
    }
    for i in 0..nodes {
        body.push_str(&format!("  n{i}.{}.label = input + '{i}';\n", fields[i % fields.len()]));
    }
    body.push_str(
        "  let out = '';
  for (const n of nodes) out += n.id + ':' + n.a.label + n.b.id + n.c.d.label + ',';
  return out;
}
",
    );
    std::fs::create_dir(tmp.path().join("tp")).unwrap();
    std::fs::write(tmp.path().join("tp/run.mjs"), body).unwrap();
    std::fs::write(tmp.path().join("package.json"), r#"{"type":"module"}"#).unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        r#"import { defineConfig, text, mutation } from "typedpress";
import { run } from "./tp/run.mjs";
const __a = mutation({ access: "anyone" }, async (input: { s: string }) => { return { v: run(input.s) }; }); export { __a as a }; export default defineConfig({ name: "graph" });
"#,
    )
    .unwrap();

    if cfg!(debug_assertions) {
        let solve = |run: usize| {
            let dump = tmp.path().join(format!("effects-{run}.txt"));
            let work = tmp.path().join(format!("work-{run}.txt"));
            let out = first()
                .args(["check", "--json"])
                .arg(tmp.path())
                .env("TP_DEBUG_EFFECTS", &dump)
                .env("TP_DEBUG_EFFECTS_WORK", &work)
                .output()
                .unwrap();
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
            (
                std::fs::read_to_string(dump).expect("debug builds dump the solved effects"),
                std::fs::read_to_string(work).expect("debug builds record the solver's work"),
            )
        };
        let (dump, work) = solve(0);
        let field = |name: &str| -> u64 {
            work.split_whitespace()
                .find_map(|part| part.strip_prefix(name)?.strip_prefix('='))
                .and_then(|n| n.parse().ok())
                .unwrap_or_else(|| panic!("{name} in {work:?}"))
        };
        let (projections, facts) = (field("projections"), field("facts"));
        assert!(
            dump.lines().any(|line| line.starts_with("widened ")),
            "the program no longer reaches widening"
        );
        // The previous solver made 41M projections here for 28K facts at 8 nodes, and did not
        // finish within 90 s at 12.
        assert!(
            projections < 5 * facts && facts < 200_000,
            "the effects solver runs away: {projections} projections for {facts} facts"
        );
        assert_eq!(dump, solve(1).0, "the widened effects depend on the run");
    }

    let inputs = ["", "x", "a b"];
    let node = Command::new("node")
        .current_dir(tmp.path())
        .args(["--input-type=module", "-e"])
        .arg(format!(
            "import {{ run }} from './tp/run.mjs'; process.stdout.write(JSON.stringify({}.map(s => ({{ v: run(s) }}))));",
            serde_json::to_string(&inputs).unwrap()
        ))
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let content = build_wp(tmp.path());
    let actual = php(
        &format!(
            r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$fn = '\\TypedPressApp\\' . $schema['actions']['a']['handler'];
$out = [];
foreach (json_decode('{}') as $s) {{
    $input = new \TypedPress\JsObject();
    $input->p['s'] = $s;
    $out[] = json_decode(\TypedPress\Js::jsonStringify($fn($input, new \TypedPress\JsObject())));
}}
echo json_encode($out);
"#,
            serde_json::to_string(&inputs).unwrap()
        ),
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-graph/tp/app"),
        ],
    );
    assert_eq!(actual, expected);
}

/// A token parser shaped like picomatch's `parse()`: each branch writes through `prev`,
/// `prev.prev` and `prev.prev.prev`, so the effect places below those bindings multiply past
/// the solver's widening threshold. The solve restarts with them widened
/// (docs/decisions/2026-11-08-effects-widening.md). Debug builds name the widened bindings in
/// the `TP_DEBUG_EFFECTS` dump, which must be the same on every run, and the generated PHP
/// must still compute what Node computes.
#[test]
fn widened_effects_are_deterministic_and_keep_php_equal_to_node() {
    let tmp = tempfile::tempdir().unwrap();
    let mut body = String::from(
        "export function run(input) {
  const words = input.split(' ');
  const state = { index: -1, output: '', prev: null, depth: 0, opened: [] };
  const bos = { type: 'bos', value: '', output: '', prev: null };
  const tokens = [bos];
  let prev = bos;
  const push = tok => {
    if (prev.type === tok.type && tok.type === 'text') { prev.value += tok.value; prev.output += tok.value; return; }
    tok.prev = prev; tokens.push(tok); prev = tok; state.prev = tok;
  };
  while (state.index < words.length - 1) {
    const value = words[++state.index];
",
    );
    let fields = ["type", "value", "output", "inner", "close", "depth"];
    for (i, (set, read)) in fields
        .iter()
        .flat_map(|set| fields[..2].iter().map(move |read| (set, read)))
        .enumerate()
    {
        body.push_str(&format!(
            "    if (value === 't{i}') {{ const t = {{ type: '{set}', value, output: prev.{read} + value, prev: prev.prev }}; if (prev.prev) {{ prev.prev.{set} = prev.{read}; if (prev.prev.prev) prev.prev.prev.{read} = value; }} push(t); state.opened.push(t); state.depth++; continue; }}\n"
        ));
    }
    body.push_str(
        "    push({ type: 'text', value, output: value });
  }
  return tokens.map(t => String(t.type) + '=' + String(t.output) + '/' + String(t.value)).join(',') + '|' + state.depth + '|' + state.opened.length;
}
",
    );
    std::fs::create_dir(tmp.path().join("tp")).unwrap();
    std::fs::write(tmp.path().join("tp/run.mjs"), body).unwrap();
    std::fs::write(tmp.path().join("package.json"), r#"{"type":"module"}"#).unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        r#"import { defineConfig, text, mutation } from "typedpress";
import { run } from "./tp/run.mjs";
const __a = mutation({ access: "anyone" }, async (input: { s: string }) => { return { v: run(input.s) }; }); export { __a as a }; export default defineConfig({ name: "tokens" });
"#,
    )
    .unwrap();

    if cfg!(debug_assertions) {
        let dump = |run: usize| {
            let file = tmp.path().join(format!("effects-{run}.txt"));
            let out = first()
                .args(["check", "--json"])
                .arg(tmp.path())
                .env("TP_DEBUG_EFFECTS", &file)
                .output()
                .unwrap();
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
            std::fs::read_to_string(file).expect("debug builds dump the solved effects")
        };
        let first = dump(0);
        let widened = first.lines().filter(|line| line.starts_with("widened ")).count();
        assert!(widened > 0, "the program no longer reaches the widening threshold");
        // A fresh process has fresh hash seeds; the widened bindings and every place must not move.
        assert_eq!(first, dump(1), "the widened effects depend on the run");
    }

    let inputs = [
        "t0 t3 x t7 t11 y t2 t9 t9 t5",
        "",
        "t1 t1 t1",
        "a b c t4 t6 t8 t10",
        "t11 t10 t9 t8 t7 t6 t5 t4 t3 t2 t1 t0",
        "x y t3 z t3 w",
    ];
    let node = Command::new("node")
        .current_dir(tmp.path())
        .args(["--input-type=module", "-e"])
        .arg(format!(
            "import {{ run }} from './tp/run.mjs'; process.stdout.write(JSON.stringify({}.map(s => ({{ v: run(s) }}))));",
            serde_json::to_string(&inputs).unwrap()
        ))
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let content = build_wp(tmp.path());
    let actual = php(
        &format!(
            r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$fn = '\\TypedPressApp\\' . $schema['actions']['a']['handler'];
$out = [];
foreach (json_decode('{}') as $s) {{
    $input = new \TypedPress\JsObject();
    $input->p['s'] = $s;
    $out[] = json_decode(\TypedPress\Js::jsonStringify($fn($input, new \TypedPress\JsObject())));
}}
echo json_encode($out);
"#,
            serde_json::to_string(&inputs).unwrap()
        ),
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-tokens/tp/app"),
        ],
    );
    assert_eq!(actual, expected);
}

/// Type-level rules of the language constructs added for 0.8 apps (first#138): each source either
/// checks cleanly or is refused with the named diagnostic, matching TypeScript or JavaScript.
#[test]
fn language_construct_type_rules() {
    let cases: &[(&str, &str, Option<&str>)] = &[
        // A typo in `delete` is a missing field, as for any typed read.
        (
            "type D = { title: string; secret?: string }; function g(d: D) { delete d.secert; return d; }",
            "g({ title: 't' })",
            Some("has no field `secert`"),
        ),
        (
            "type D = { title: string; secret?: string }; function g(d: D) { delete d.secret; return d; }",
            "g({ title: 't' })",
            None,
        ),
        // The built-in error subclasses are types, as `Error` is.
        (
            "function named(e: TypeError | RangeError | SyntaxError): string { return e.name; } function made(): RangeError { return new RangeError('r'); }",
            "{ const t: TypeError = new TypeError('t'); return [named(t), named(made()), made().message]; }",
            None,
        ),
        // A constructor return value stays refused when a label wraps it.
        (
            "class C { n = 1; constructor() { result: { if (this.n) return { n: 2 } as unknown as C; } } }",
            "new C().n",
            Some("constructor return values"),
        ),
        // A `never` do-while test ends the function; no fall-through return is needed.
        (
            "function fail(): never { throw new Error('x'); } function f(): number { do {} while (fail()); }",
            "f()",
            None,
        ),
        // An invalid escape still passes a TemplateStringsArray, whose element is undefined at runtime.
        (
            "function tag(s: TemplateStringsArray) { return s.length; }",
            "tag`\\unicode`",
            None,
        ),
    ];
    for (declarations, handler, refusal) in cases {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("typedpress.config.ts"),
            format!("import {{ defineConfig, mutation }} from 'typedpress';\n{declarations}\nconst __probe = mutation({{}}, () => {handler}); export {{ __probe as probe }}; export default defineConfig({{ name: 'rules' }});"),
        )
        .unwrap();
        let (out, report) = checked(tmp.path());
        match refusal {
            None => assert_eq!(out.status.code(), Some(0), "{declarations}: {report}"),
            Some(message) => {
                assert_eq!(out.status.code(), Some(1), "{declarations}: {report}");
                assert!(
                    report["diagnostics"][0]["message"].as_str().unwrap().contains(message),
                    "{declarations}: {report}"
                );
            }
        }
    }
}

#[test]
fn build_time_namespaces_resolve_members_and_refuse_whole_values() {
    // picomatch's shape: a function with own properties, Object.assign onto it, a default export
    // object, and helper objects called as `utils.f(x)` from another module.
    let tmp = tempfile::tempdir().unwrap();
    write_app(
        tmp.path().join("tp/utils.mjs"),
        r#"
export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const constants = { REGEX_SLASH: /\//g, DEFAULT: { depth: 1 } };
const pico = (glob) => (input) => input.startsWith(glob);
pico.scan = (input) => ({ base: input.split('/')[0] });
pico.constants = constants;
function main(glob, options) { return pico(isObject(options) ? options.prefix + glob : glob); }
Object.assign(main, pico, undefined, { version: '4.0.7' });
main.makeRe = (glob) => new RegExp('^' + glob.replace(constants.REGEX_SLASH, '\\/'));
export default main;
"#,
    )
    .unwrap();
    let expression = r#"[match('src')('src/a.ts'), match('a', { prefix: 'src/' })('src/a.ts'), match.version, match.scan('src/b').base,
  match.makeRe('a/b').source, match.makeRe('a/b').test('a/bc'), match.constants.DEFAULT.depth, utils.isObject({}), utils.isObject(null),
  utils.constants.REGEX_SLASH.flags, utils.constants.DEFAULT === match.constants.DEFAULT]"#;
    let node = Command::new("node")
        .current_dir(tmp.path())
        .args([
            "--input-type=module",
            "-e",
            &format!("import match from './tp/utils.mjs'; import * as utils from './tp/utils.mjs'; process.stdout.write(JSON.stringify({expression}));"),
        ])
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        format!(
            r#"
import {{ defineConfig, mutation }} from 'typedpress';
import match from './tp/utils.mjs';
import * as utils from './tp/utils.mjs';
const __probe = mutation({{}}, () => {expression}); export {{ __probe as probe }}; export default defineConfig({{ name: 'namespaces' }});
"#
        ),
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let actual = php(
        r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$fn = '\\TypedPressApp\\' . $schema['actions']['probe']['handler'];
echo \TypedPress\Js::jsonStringify($fn(new \TypedPress\JsObject(), new \TypedPress\JsObject()));
"#,
        &[
            &content.join("plugins/typedpress-runtime/tp/bootstrap.php"),
            &content.join("plugins/typedpress-app-namespaces/tp/app"),
        ],
    );
    assert_eq!(actual, expected);
    // The namespace object and the function with properties are never built in PHP.
    let functions =
        std::fs::read_to_string(content.join("plugins/typedpress-app-namespaces/tp/app/functions.php")).unwrap();
    assert!(!functions.contains("'version'"), "{functions}");

    for (declarations, handler, message, help) in [
        (
            "const o = { f: (n: number) => n };",
            "{ const copy = { ...o }; return 1; }",
            "`o` holds functions",
            "o.f(...)",
        ),
        (
            "const o = { f: (n: number) => n };",
            "{ o.f = (n: number) => n + 1; return 1; }",
            "`o` holds functions",
            "o.f(...)",
        ),
        (
            "const o = { f: (n: number) => n };",
            "o.missing",
            "`o.missing` doesn't exist",
            "",
        ),
        (
            "const o = { f: (n: number) => n };",
            "o.hasOwnProperty('f')",
            "reads an inherited property",
            "own property",
        ),
        (
            "function f() { return 1; } f.x = 1;",
            "typeof f",
            "function with properties",
            "f.x",
        ),
        (
            "function f() { return 1; } f.x = 1;",
            "f.name",
            "isn't supported on a function with properties",
            "name",
        ),
        (
            "function f() { return 1; } f.name = 'g';",
            "f()",
            "can't set `name` on a function",
            "aren't modeled",
        ),
        (
            "function f() { return 1; } const n = f.length;",
            "n",
            "reading `length` of a function",
            "aren't modeled",
        ),
        (
            "const target = Object.assign(1, {});",
            "target",
            "needs an object or function target",
            "plain object",
        ),
        (
            "function f() { return 1; }",
            "Object.assign({}, { a: 1 })",
            "unsupported overload of `Object.assign`",
            "build time only",
        ),
    ] {
        std::fs::write(tmp.path().join("typedpress.config.ts"), format!("import {{defineConfig, mutation}} from 'typedpress';\n{declarations}\nconst __probe = mutation({{}}, ()=>{handler}); export {{ __probe as probe }}; export default defineConfig({{ name:'namespaces' }});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let d = &report["diagnostics"][0];
        assert!(d["message"].as_str().unwrap().contains(message), "{message}: {report}");
        assert!(d["location"].is_object(), "{report}");
        assert!(d["help"].as_str().unwrap_or("").contains(help), "{help}: {report}");
    }
}

/// Authored TypeScript runs `for await` only over sync iterables of settled values (TypedPress's own
/// promises or plain values). Values from imported JavaScript and async generators need the job
/// queue, which only imported JavaScript has, so they keep a located refusal.
#[test]
fn typed_for_await_accepts_only_settled_sync_iterables() {
    for (source, ok) in [
        (
            "const out: number[] = []; for await (const v of [1, 2]) out.push(v); return out;",
            true,
        ),
        (
            "const out: number[] = []; for await (const v of untyped()) out.push(v as number); return out;",
            false,
        ),
        (
            "async function* gen() { yield 1; } const out: number[] = []; for await (const v of gen()) out.push(v); return out;",
            false,
        ),
        // PromiseResolve adopts a thenable, so its element is not settled.
        (
            "const t = { then(resolve: (v: number) => void) { resolve(1); } }; const out: unknown[] = []; for await (const v of [t]) out.push(v); return out;",
            false,
        ),
        (
            "const out: unknown[] = []; for await (const v of [{ n: 1 }, null]) out.push(v); return out;",
            true,
        ),
        (
            "const t: { then: (resolve: (v: number) => void) => void } = { then: (resolve: (v: number) => void) => resolve(1) }; const out: unknown[] = []; for await (const v of [t]) out.push(v); return out;",
            false,
        ),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        write_app(
            tmp.path().join("tp/h.mjs"),
            "export function untyped() { return [1, 2]; }\n",
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("typedpress.config.ts"),
            format!("import {{ defineConfig, mutation }} from 'typedpress';\nimport {{ untyped }} from './tp/h.mjs';\nconst __probe = mutation({{}}, async () => {{ {source} }}); export {{ __probe as probe }}; export default defineConfig({{ name: 'awaits' }});"),
        )
        .unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(if ok { 0 } else { 1 }), "{source}: {report}");
        if !ok {
            assert!(
                report["diagnostics"][0]["message"]
                    .as_str()
                    .unwrap()
                    .contains("only work"),
                "{source}: {report}"
            );
        }
    }
}

/// Every refusal names what to write instead, so an author (often an agent) can act on it. Each
/// source here hits one `TypedPress code doesn't support ...` refusal; the diagnostic must carry a
/// location and non-empty help. Add a case whenever a refusal is added.
#[test]
fn language_refusals_carry_a_location_and_a_fix() {
    // (name, declarations, handler body, message, help): the handler reaches each construct so it
    // is compiled; the message (and help, when given) names this refusal and no other.
    let cases: &[(&str, &str, &str, &str, &str)] = &[
        (
            "with",
            "",
            "{ const o = { a: 1 }; with (o) { return a; } }",
            "doesn't support `with`",
            "",
        ),
        (
            "debugger",
            "",
            "{ debugger; return 1; }",
            "doesn't support `debugger`",
            "",
        ),
        (
            "this at module level",
            "const self = () => this;",
            "self()",
            "`this` at module level",
            "",
        ),
        ("enum", "enum Unit { Pcs, G }", "Unit.Pcs", "doesn't support `enum`", ""),
        (
            "namespace",
            "namespace N { export const x = 1; }",
            "N.x",
            "doesn't support namespaces",
            "",
        ),
        (
            "computed destructuring key",
            "",
            "{ const o: Record<string, number> = {}; const k = 'a'; const { [k]: v } = o; return v; }",
            "computed keys in destructuring",
            "",
        ),
        (
            "nested rest",
            "",
            "{ const a = [[1]]; const [...[x]] = a; return x; }",
            "nested rest patterns",
            "",
        ),
        ("array holes", "", "[1, , 2]", "array holes", ""),
        (
            "getters and setters",
            "",
            "({ get x() { return 1; } }).x",
            "getters and setters",
            "",
        ),
        (
            "generators",
            "function* g(): Generator<number> { yield 1; }",
            "[...g()]",
            "generators only work in imported JavaScript",
            "",
        ),
        (
            "delete of a variable",
            "",
            "{ let x = 1; return delete (x as unknown as { y?: number }); }",
            "`delete` of a variable",
            "",
        ),
        (
            "call signature",
            "type F = { (x: number): string };",
            "{ const f: F = (x: number) => String(x); return f(1); }",
            "call and construct signatures",
            "",
        ),
        (
            "dynamic import",
            "",
            "{ const m = import('./x'); return 1; }",
            "dynamic `import()`",
            "",
        ),
        (
            "this through a module namespace",
            "import * as ns from './tp/ns.mjs';",
            "ns.nsThis()",
            "through the module namespace `ns`",
            "",
        ),
        (
            "function with properties in a this receiver",
            "import { withHelper } from './tp/ns.mjs';",
            "withHelper.read()",
            "a function with properties (`withHelper.helper`)",
            "",
        ),
        (
            "methods calling each other without return types",
            "",
            "({ a() { return this.b(); }, b() { return this.a(); } }).a()",
            "has no field `a`",
            "call each other through `this`",
        ),
        (
            "handler reading this",
            "export const other = mutation({}, function () { return typeof this; });",
            "1",
            "without a receiver, so `this` is undefined",
            "",
        ),
        (
            "module-level literal method used apart from its object",
            "const api = { n: 1, f() { return this.n; } };",
            "{ const g = api.f; return g(); }",
            "using `api.f` apart from the object literal",
            "",
        ),
        (
            "module-level literal method copied onto another object",
            "const api = { n: 1, f() { return this.n; } }; const copy = { ...api, n: 2 };",
            "copy.f()",
            "using `copy.f` apart from the object literal",
            "",
        ),
        (
            "untyped this outside an object literal",
            "const api = { n: 1, f() { return this.n; } }; api.f = function () { return this.n; };",
            "api.f()",
            "`this` without a type in a function that isn't a method",
            "",
        ),
        (
            "module-level literal methods calling each other without return types",
            "const api = { a() { return this.b(); }, b() { return this.a(); } };",
            "api.a()",
            "has no field `a`",
            "`a` and `b` call each other through `this`",
        ),
        (
            "module-level literal method calling itself without a return type",
            "const api = { n: 1, fact(k: number, j: string) { return k ? this.n * this.fact(k - 1, j) : j.length; } };",
            "api.fact(2, 'a')",
            "has no field `fact`",
            "`fact` calls itself through `this`; annotate its return type, e.g. `fact(k: number, j: string): number`",
        ),
        (
            "three module-level methods in a cycle",
            "const api = { a() { return this.b(); }, b() { return this.c(); }, c() { return this.a(); } };",
            "api.a()",
            "has no field `a`",
            "a cycle through `this`; annotate the return type of `a`",
        ),
        (
            "three local methods in a cycle",
            "",
            "({ a() { return this.b(); }, b() { return this.c(); }, c() { return this.a(); } }).a()",
            "has no field `a`",
            "a cycle through `this`; annotate the return type of `a`",
        ),
        (
            "receiver-typed callback",
            "",
            "[1].map(function (this: { x: number }, value) { return this.x + value; })",
            "so `this` is undefined, not { x: number }",
            "",
        ),
        (
            "receiver-typed callback by reference",
            "function add(this: { x: number }, v: number) { return this.x + v; }",
            "[1].map(add)",
            "so `this` is undefined, not { x: number }",
            "capture the object",
        ),
        (
            "an annotated method's receiver does not type a nested ordinary function",
            "",
            "({ n: 2, f(this: { n: number }) { void this; function g() { return this.n; } return g(); } }).f()",
            "`this` without a type in a function that isn't a method",
            "declare it",
        ),
        (
            "this before super",
            "class A {} class B extends A { constructor(public n: number = (this as unknown as { n: number }).n) { super(); } }",
            "new B()",
            "before `super()` in a derived constructor",
            "",
        ),
    ];
    for (name, declarations, handler, message, fix) in cases {
        let tmp = tempfile::tempdir().unwrap();
        write_app(tmp.path().join("tp/ns.mjs"),
            "export function nsThis() { return typeof this; }\nfunction helper() { return 1; }\nhelper.x = 42;\nexport const withHelper = { helper, read() { return this.helper.x; } };\n",
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("typedpress.config.ts"),
            format!("import {{ defineConfig, mutation }} from 'typedpress';\n{declarations}\nconst __probe = mutation({{}}, () => {handler}); export {{ __probe as probe }}; export default defineConfig({{}});\n"),
        )
        .unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{name}: {report}");
        let diagnostic = &report["diagnostics"][0];
        assert!(
            diagnostic["location"]["line"].as_u64().is_some_and(|l| l >= 2),
            "{name}: {report}"
        );
        assert!(
            diagnostic["message"].as_str().unwrap_or("").contains(message),
            "{name}: {report}"
        );
        let help = diagnostic["help"].as_str().unwrap_or("");
        assert!(!help.trim().is_empty(), "{name}: refusal without a fix: {report}");
        assert!(help.contains(fix), "{name}: {report}");
    }
}

/// `.was()` and `was:` are removed in favor of forward-only `.column()` / `storageName`, and
/// an `existingTable` binding cannot change once adopted.
#[test]
fn was_renames_only_what_a_table_stores() {
    let tmp = tempfile::tempdir().unwrap();
    let build = |config: &str, entries: Vec<(String, Value)>| -> Result<typedpress::pipeline::Built, String> {
        std::fs::write(tmp.path().join("typedpress.config.ts"), config).unwrap();
        let program = typedpress::loader::load(&tmp.path().join("typedpress.config.ts")).map_err(|d| d.message)?;
        typedpress::pipeline::build(
            tmp.path(),
            &program,
            || typedpress::pipeline::Previous::from_entries(entries.clone()),
            |_| None,
        )
        .map_err(|d| d.message)
    };
    let refused = |config: &str| build(config, vec![]).err().unwrap_or_default();
    let head = "import { defineConfig, collection, table, text, group } from 'typedpress';";
    assert!(
        refused(&format!("{head} const posts = collection({{ title: text(), body: text().was('copy').optional() }}, {{ title: 'title' }}); export {{ posts }}; export default defineConfig({{}});"))
            .contains("`.was()`"),
    );
    assert!(
        refused(&format!("{head} const notes = table({{ meta: group({{ tag: text().was('label').optional() }}).optional() }}); export {{ notes }}; export default defineConfig({{}});"))
            .contains("`.was()`"),
    );
    // `was` on table() is refused: forward-only migrations keep physical table names via `storageName`.
    let first = build(
        &format!("{head} const notes = table({{}}); export {{ notes }}; export default defineConfig({{}});"),
        vec![],
    )
    .unwrap();
    let entries: Vec<(String, Value)> = first.migrations.iter().map(|m| (m.id.clone(), m.ops.clone())).collect();
    let was_table = build(
        &format!(
            "{head} const memos = table({{}}, {{ was: 'notes' }}); export {{ memos }}; export default defineConfig({{}});"
        ),
        entries.clone(),
    );
    assert!(was_table.err().unwrap_or_default().contains("`was` is gone"),);
    // Changing storageName onto an existingTable binding is refused.
    let onto = build(
        &format!(
            "{head} const memos = table({{}}, {{ storageName: 'notes', existingTable: 'sf_space_memos' }}); export {{ memos }}; export default defineConfig({{}});"
        ),
        entries.clone(),
    );
    assert!(onto.err().unwrap_or_default().contains("existingTable binding"),);
    // Keeping the same physical table under a new TS export via `storageName` needs no DDL rename or drop.
    let kept = build(
        &format!("{head} const memos = table({{}}, {{ storageName: 'notes' }}); export {{ memos }}; export default defineConfig({{}});"),
        entries,
    )
    .unwrap();
    assert!(
        kept.migrations.is_empty(),
        "expected no DDL migration when keeping storageName: {:?}",
        kept.migrations
    );
}

/// For each collection, global and action of an app, the schema in `tp/_generated/openapi.json` is the one the registered
/// Ability publishes (a row is the `-get` output, a create input the `-create` input, a patch the
/// `-update` input's `patch`). The apps cover every field type, a users kind, localized kinds and
/// relations.
#[test]
fn openapi_schemas_are_the_registered_ability_schemas() {
    for source in ["tests/fixtures/openapi", "examples/blog"] {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("app");
        copy_dir(&root().join(source), &project);
        let _ = std::fs::remove_dir_all(project.join(".tp"));
        let content = build_wp(&project);
        let program = typedpress::loader::load(&project.join("typedpress.config.ts")).unwrap();
        let built = typedpress::pipeline::build(
            &project,
            &program,
            || Ok(typedpress::pipeline::Previous::none()),
            |_| None,
        )
        .unwrap();
        let out = Command::new("php")
            .args(["-d", "memory_limit=512M"])
            .arg(root().join("tests/php/wp.php"))
            .arg("eval")
            .arg(&content)
            .arg(
                r#"
                $out = [];
                foreach (\TypedPress\Wp\Abilities\Register::operations() as $op) {
                    $out[$op['name']] = ['input' => $op['input'], 'output' => $op['output']];
                }
                echo json_encode($out), "\n";
                "#,
            )
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        let registered: Value =
            serde_json::from_str(String::from_utf8_lossy(&out.stdout).lines().next_back().unwrap()).unwrap();
        // An Ability's input also says `default: []`, so that core accepts a call with no input; that
        // is about the call, not the value.
        let input = |name: &str| {
            let mut schema = registered[name]["input"].clone();
            assert!(schema.is_object(), "{source}: no ability {name}");
            schema.as_object_mut().unwrap().remove("default");
            schema
        };
        let schema = &built.schema;
        let components = &built.openapi["components"]["schemas"];
        let app = typedpress::wordpress::abilities::kebab(&schema.name);
        let kebab = typedpress::wordpress::abilities::kebab;
        let mut compared = 0;
        for c in schema.collections.values() {
            let k = kebab(&c.table);
            let name = typedpress::client::type_name(&c.key);
            if c.api.get {
                assert_eq!(
                    typedpress::json_schema::row(c),
                    registered[format!("{app}/{k}-get")]["output"],
                    "{source}: the row of {}",
                    c.table
                );
                // The document's row is that schema; it only adds notes and the `with` relations.
                for (field, published) in typedpress::json_schema::row(c)["properties"].as_object().unwrap() {
                    let mut documented = components[&name]["properties"][field].clone();
                    if c.relations.contains_key(field) {
                        documented = documented["anyOf"][0].clone();
                    }
                    let documented = documented.as_object_mut().unwrap();
                    documented.remove("description");
                    documented.remove("x-typedpress-access");
                    assert_eq!(
                        &Value::Object(documented.clone()),
                        published,
                        "{source}: {}.{field}",
                        c.table
                    );
                }
                compared += 1;
            }
            if c.api.create {
                assert_eq!(
                    components[format!("{name}Insert")],
                    input(&format!("{app}/{k}-create")),
                    "{source}: {name}Insert"
                );
                compared += 1;
            }
            if c.api.update {
                // The API's PATCH body also carries the write's conditions, `_rev` and `takeover`
                // (docs/staged.md); the ability takes them beside `patch`, not inside it.
                let mut body = components[format!("{name}Patch")].clone();
                let ability = &registered[format!("{app}/{k}-update")]["input"]["properties"];
                for condition in ["_rev", "takeover"] {
                    let taken = body["properties"].as_object_mut().unwrap().remove(condition);
                    assert_eq!(
                        taken.map(|t| t["type"].clone()),
                        ability.get(condition).map(|a| a["type"].clone()),
                        "{source}: {name}Patch and the update ability take `{condition}` alike"
                    );
                }
                assert_eq!(body, ability["patch"], "{source}: {name}Patch");
                compared += 1;
            }
        }
        for key in schema.globals.keys() {
            let k = kebab(key);
            // The document's own operations for the global, as a client reads them.
            let path = &built.openapi["paths"][format!("/{key}")];
            let resolve = |schema: &Value| -> Value {
                match schema["$ref"].as_str() {
                    Some(reference) => built
                        .openapi
                        .pointer(reference.trim_start_matches('#'))
                        .unwrap()
                        .clone(),
                    None => schema.clone(),
                }
            };
            assert_eq!(
                resolve(
                    &path["get"]["responses"]["200"]["content"]["application/json"]["schema"]["properties"]["data"]
                ),
                registered[format!("{app}/global-{k}-get")]["output"],
                "{source}: the global {key}"
            );
            assert_eq!(
                resolve(&path["patch"]["requestBody"]["content"]["application/json"]["schema"]),
                input(&format!("{app}/global-{k}-update")),
                "{source}: the patch of the global {key}"
            );
            compared += 2;
        }
        for action in schema.actions.values() {
            assert_eq!(
                built.openapi["paths"][format!("/actions/{}", action.name)]["post"]["requestBody"]["content"]["application/json"]
                    ["schema"],
                input(&format!("{app}/{}", kebab(&action.name))),
                "{source}: the input of the action {}",
                action.name
            );
            compared += 1;
        }
        assert!(compared >= 10, "{source}: compared {compared} schemas");
    }
}
