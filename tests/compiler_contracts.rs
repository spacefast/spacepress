//! Executable joins between compatibility claims, diagnostics, authoring and PHP behavior.

// Runs the `first` binary: only with the cli feature (the browser build of the core has none).
#![cfg(feature = "cli")]
use serde_json::{Value, json};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Writes an app module, creating its directory (app code lives under `first/`).
fn write_app(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    std::fs::create_dir_all(path.as_ref().parent().unwrap())?;
    std::fs::write(path, contents)
}

/// Copies a file into the app, creating its directory.
fn copy_app(from: impl AsRef<Path>, to: impl AsRef<Path>) -> std::io::Result<u64> {
    std::fs::create_dir_all(to.as_ref().parent().unwrap())?;
    std::fs::copy(from, to)
}

/// A project whose app is `source` and the files beside it: the sources go under `first/` (the only
/// place app code loads from) and the root `first.config.ts` re-exports `source`'s config.
fn project_from(project: &Path, source: &Path, siblings: &[&Path]) {
    let app = project.join("first");
    std::fs::create_dir_all(&app).unwrap();
    for sibling in siblings {
        std::fs::copy(sibling, app.join(sibling.file_name().unwrap())).unwrap();
    }
    let name = source.file_name().unwrap().to_str().unwrap();
    std::fs::copy(source, app.join(name)).unwrap();
    std::fs::write(
        project.join("first.config.ts"),
        format!("export {{ default }} from \"./first/{name}\";\n"),
    )
    .unwrap();
}

fn first() -> Command {
    Command::new(env!("CARGO_BIN_EXE_first"))
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
    let output = project.join("first/dist/wp-content");
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
    let source = "import './a';\nimport './b';\n/*😀*/ abstract class First {}\nabstract class Second {}\nconst clock = Date.now();\n";
    let source = source.replace("'./a'", "'./first/a'").replace("'./b'", "'./first/b'");
    let source = source.as_str();
    std::fs::write(tmp.path().join("first.config.ts"), source).unwrap();
    for name in ["a.ts", "b.ts"] {
        write_app(tmp.path().join("first").join(name), "abstract class Imported {}\n").unwrap();
    }
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(report["schema"], "first-diagnostics");
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
    assert_eq!(loc["file"], "first.config.ts");
    assert_eq!(loc["start"], source.find("abstract class First").unwrap());
    assert_eq!(loc["column"], "/*😀*/ ".encode_utf16().count() + 1);
    assert_eq!(loc["line"], 3);
    assert_eq!(report, checked(tmp.path()).1, "diagnostics must be deterministic");
    assert!(!tmp.path().join("first/_generated").exists() && !tmp.path().join("first/dist").exists());
    assert!(!tmp.path().join(".first").exists());
    // A partially lowered program must never run the Date.now() declaration.
    assert!(!report.to_string().contains("F2101"));
    let human = first().arg("check").arg(tmp.path()).output().unwrap();
    assert_eq!(human.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&human.stderr).contains("abstract, ambient or generic classes"));
}

#[test]
fn successful_json_check_and_the_reusable_recipe_write_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    for file in ["first.config.ts", "first/seo.ts"] {
        copy_app(root().join("examples/recipes").join(file), tmp.path().join(file)).unwrap();
    }
    let (out, report) = checked(tmp.path());
    assert!(out.status.success(), "{report}");
    assert_eq!(report["ok"], true);
    assert_eq!(report["diagnostics"], json!([]));
    assert_eq!(report["groups"], json!([]));
    assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 2);
}

/// `first check --json` lists each SQL index the deploy keeps and why it exists (spec §2.9).
/// `.index(fields, { unique? })` (spec §2.9): a compound index the migration creates and `first check
/// --json` lists with its reason; a field the kind doesn't have is refused where it is written.
#[test]
fn a_declared_index_is_created_and_listed() {
    let tmp = tempfile::tempdir().unwrap();
    write_app(
        tmp.path().join("first.config.ts"),
        "import { defineConfig } from \"first\";\nexport default defineConfig({ name: \"likes\" });\n",
    )
    .unwrap();
    write_app(
        tmp.path().join("first/schema.ts"),
        "import { table, integer } from \"first\";\nexport const likes = table({ post: integer(), author: integer() }).index([\"post\", \"author\"], { unique: true });\n",
    )
    .unwrap();
    let (out, report) = checked(tmp.path());
    assert!(out.status.success(), "{report}");
    assert!(
        report["indexes"].as_array().unwrap().contains(&json!({ "table": "likes", "name": "idx_post_author", "unique": true, "columns": ["post", "author"], "reason": "declared with .index([\"post\", \"author\"], { unique: true })" })),
        "{report}"
    );
    let built = first().args(["build", "--quiet"]).arg(tmp.path()).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let sql = std::fs::read_to_string(tmp.path().join("first/_generated/migrations/0001_init.sql")).unwrap();
    assert!(sql.contains("UNIQUE KEY `idx_post_author` (`post`, `author`)"), "{sql}");

    write_app(
        tmp.path().join("first/schema.ts"),
        "import { table, integer } from \"first\";\nexport const likes = table({ post: integer() }).index([\"psot\"]);\n",
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
        root().join("examples/pantry/first.config.ts"),
        tmp.path().join("first.config.ts"),
    )
    .unwrap();
    copy_app(
        root().join("examples/pantry/first/lib/fields.ts"),
        tmp.path().join("first/lib/fields.ts"),
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
        json!({ "table": "items", "name": "slug_unique", "unique": true, "columns": ["slug"], "reason": "`slug` is .unique()" })
    );
    assert_eq!(
        find("items", "first_items_locationId_fk")["reason"],
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
    let config = r#"import { collection, defineConfig, text, group, repeater, blocks, json } from "first";
const notes = collection({
  title: text(),
  seo: group({ summary: text().ui({ label: "Display name", help: "<b>Plain text</b>", placeholder: "Jane", width: 50 }).optional() }).ui({ label: "SEO" }).optional(),
  rows: repeater({ value: text().ui({ label: "Row value", help: undefined, placeholder: undefined, width: undefined }).optional() }).optional(),
  content: blocks({ hero: { heading: text().ui({ label: "Heading" }).optional() } }).optional(),
  metadata: json().optional(),
}, { title: "title" });
export default defineConfig({ name: "presentation", collections: { notes } });"#;
    std::fs::write(tmp.path().join("first.config.ts"), config).unwrap();
    let content = build_wp(tmp.path());
    let schema = content.join("plugins/first-app-presentation/first/app/schema.php");
    let got = php(
        r#"
        require $argv[1];
        $schema = \First\Schema::load($argv[2]);
        $columns = $schema->collection('notes')['columns'];
        $field = \First\Wp\Scf::fieldFor($schema, 'field_seo', 'first_seo', 'seo', $columns['seo'], []);
        $json = \First\Wp\Scf::fieldFor($schema, 'field_metadata', 'first_metadata', 'metadata', $columns['metadata'], []);
        echo json_encode(['columns' => $columns, 'public' => $schema->describe()['collections']['notes']['columns'], 'field' => $field, 'json' => $json]);
    "#,
        &[&content.join("plugins/first-runtime/first/bootstrap.php"), &schema],
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
    let snapshot = tmp.path().join("first/_generated/migrations/snapshot.json");
    let before = std::fs::read(&snapshot).unwrap();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        config.replace("width: 50", "width: 100"),
    )
    .unwrap();
    build_wp(tmp.path());
    assert_eq!(
        std::fs::read(snapshot).unwrap(),
        before,
        "presentation changes cannot change storage"
    );
    assert_eq!(
        std::fs::read_dir(tmp.path().join("first/_generated/migrations"))
            .unwrap()
            .filter(|entry| entry.as_ref().unwrap().path().extension().is_some_and(|e| e == "sql"))
            .count(),
        1,
        "a presentation change planned a migration"
    );
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
        std::fs::write(tmp.path().join("first.config.ts"), format!(
            "import {{ collection, text, defineConfig }} from 'first'; const notes = collection({{ title: text().ui({ui}).optional() }}, {{ title: 'title' }}); export default defineConfig({{ collections: {{ notes }} }});"
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
    std::fs::write(tmp.path().join("first.config.ts"), format!(r#"
import {{ collection, text, json, action, defineConfig }} from "first";
const values = {values};
const encoded = values.map(value => [encodeURI(value), encodeURIComponent(value)]);
const notes = collection({{ title: text(), result: json().default(encoded).optional() }}, {{ title: "title" }});
export default defineConfig({{ name: "uri", collections: {{ notes }}, actions: {{ encode: action({{ input: {{}}, handler: () => values.map(value => [encodeURI(value), encodeURIComponent(value)]) }}) }} }});
"#)).unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/first-app-uri/first/app");
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\FirstApp\\' . $schema['actions']['encode']['handler'];
        echo \First\Js::jsonStringify([\First\Js::decodeJson($schema['collections']['notes']['columns']['result']['default']['json']), $fn(new \First\JsObject(), \First\Seam::ctx(['user' => null]))]);
    "#,
        &[&content.join("plugins/first-runtime/first/bootstrap.php"), &app],
    );
    assert_eq!(result, json!([expected, expected]));
    let invalid = php(
        r#"
        require $argv[1];
        try { \First\Js::encodeURI("\xC0\xAF"); echo json_encode('accepted'); }
        catch (\First\JsError $e) { echo json_encode($e->jsName); }
    "#,
        &[&root().join("runtime/First/bootstrap.php")],
    );
    assert_eq!(invalid, "URIError");
}

#[test]
fn timers_run_only_while_the_request_waits_and_refuse_to_outlive_the_handler() {
    // A timer still pending when the handler returns would fire after the response in Node; the PHP
    // request ends first, so the runtime refuses at handler end and names the creation site.
    let tmp = tempfile::tempdir().unwrap();
    write_app(tmp.path().join("first/timers.js"),
        "export function pending(){ setTimeout(() => {}, 5); return 1; }\nexport function cleared(){ const h = setTimeout(() => {}, 5); clearTimeout(h); AbortSignal.timeout(5); return 2; }\nexport function late(){ const h = setTimeout(() => {}, 'x'); return typeof h; }",
    )
    .unwrap();
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first';import {pending,cleared,late} from './first/timers.js';export default defineConfig({name:'timers',actions:{pending:action({handler:()=>pending()}),cleared:action({handler:()=>cleared()}),late:action({handler:()=>late()})}});").unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$s=require $argv[2].'/schema.php';require $argv[2].'/functions.php';
        $out=[];
        foreach (['pending','cleared','late'] as $a) {
            $fn='\\FirstApp\\'.$s['actions'][$a]['handler'];
            try { $out[]=['ok', \First\Timers::run(fn() => $fn(new \First\JsObject(), \First\Seam::ctx(['user'=>null])))]; }
            catch (\First\JsError $e) { $out[]=[$e->jsName, $e->getMessage()]; }
            $out[]=\First\Timers::pending();
        }
        echo json_encode($out);"#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-timers/first/app"),
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
        putenv('FIRST_NOW=1000'); putenv('FIRST_TIMER_BUDGET_MS=100');
        $log=[];
        \First\Timers::set(function() use (&$log) { $log[]='b'; }, 20);
        \First\Timers::set(function() use (&$log) { $log[]='a'; }, 10);
        \First\Timers::set(function() use (&$log) { $log[]='c'; }, 20);
        $signal = \First\JsAbortSignal::timeout(15);
        while (\First\Timers::runNext()) { $log[] = \First\Timers::clock(); }
        \First\Timers::set(function() {}, 500);
        try { \First\Timers::runNext(); $log[]='slept'; } catch (\First\JsError $e) { $log[]=$e->jsName; }
        // A throwing abort listener: dispatch continues (as in Node), then the error ends the
        // request where Node would report it as uncaught.
        $faulty = new \First\JsAbortController(); $seen = [];
        $faulty->signal->addEventListener('abort', function () use (&$seen) { $seen[] = 1; throw new \First\JsError('listener'); });
        $faulty->signal->addEventListener('abort', function () use (&$seen) { $seen[] = 2; });
        try { $faulty->abort(); } catch (\First\JsError $e) { $seen[] = $e->getMessage(); }
        echo json_encode([$log, $signal->aborted, $signal->reason->jsName, $seen]);"#,
        &[&root().join("runtime/First/bootstrap.php")],
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
    copy_app(dir.join("url.js"), tmp.path().join("first/url.js")).unwrap();
    std::fs::write(tmp.path().join("cases.json"), Value::Array(cases).to_string()).unwrap();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        r#"import { action, defineConfig } from "first";
import { parseAll, searchParams, invalid } from "./first/url.js";
export default defineConfig({ name: "url", actions: { probe: action({ input: {}, handler: () => [searchParams(), invalid()] }) } });
"#,
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/first-app-url/first/app");
    // parseAll takes a data argument the action input can't carry at this size; call the compiled
    // module function directly with the decoded cases.
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\FirstApp\\' . $schema['actions']['probe']['handler'];
        $probe = $fn(new \First\JsObject(), \First\Seam::ctx(['user' => null]));
        $cases = \First\Js::decodeJson(file_get_contents($argv[3]));
        $parse = static function ($cases) {
            $props = ['href', 'origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'];
            $out = [];
            foreach ($cases->a as $c) {
                $base = \First\Js::dynamicGet($c, 'base');
                $parsed = \First\Js::dynamicStaticCall('URL', 'parse', new \First\JsArray($base === null ? [\First\Js::dynamicGet($c, 'input')] : [\First\Js::dynamicGet($c, 'input'), $base]));
                $out[] = $parsed === null ? null : new \First\JsArray(array_map(static fn ($p) => \First\Js::dynamicGet($parsed, $p), $props));
            }
            return new \First\JsArray($out);
        };
        echo \First\Js::jsonStringify(new \First\JsArray([$parse($cases), ...$probe->a]));
    "#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
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
    std::fs::write(tmp.path().join("first.config.ts"), "const x = ;").unwrap();
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
            std::fs::write(tmp.path().join("first.config.ts"), format!(r#"
import {{ collection, text, action, defineConfig }} from "first";
const result = {invocation};
const notes = collection({{ title: text() }}, {{ title: "title" }});
export default defineConfig({{ collections: {{ notes }}, actions: {{ encode: action({{ input: {{}}, handler: {handler_body} }}) }} }});
"#, handler_body = if handler { "result".to_string() } else { "() => result".to_string() })).unwrap();
            let (out, report) = checked(tmp.path());
            assert_eq!(out.status.code(), Some(1), "{expression}: {report}");
            assert_eq!(report["ok"], false);
            assert!(!tmp.path().join(".first").exists());
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
            tmp.path().join("first.config.ts"),
            format!(
                r#"
import {{ action, defineConfig }} from "first";
{helper}
export default defineConfig({{ actions: {{ probe: action({{ input: {{}}, handler: () => guard }}) }} }});
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
    write_app(tmp.path().join("first/helpers.mjs"), helper).unwrap();
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
        .args(["--input-type=module-typescript", "-e", &format!("import {{combine, read, absent, objects, replaceCount, replaceCopiedSlot, methodOrder, missingKinds, errorEffects}} from './first/helpers.mjs'; {mutation} process.stdout.write(JSON.stringify({expression}));")])
        .output().unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    std::fs::write(tmp.path().join("first.config.ts"), format!(r#"
import {{ action, defineConfig }} from 'first';
import {{ combine, read, absent, objects, replaceCount, replaceCopiedSlot, methodOrder, missingKinds, errorEffects }} from './first/helpers.mjs';
{mutation}
function nullable(value: string | null) {{ return value.trim(); }}
export default defineConfig({{ name: 'js-values', actions: {{
  probe: action({{ input: {{}}, handler: () => {expression} }}),
  dynamicError: action({{ input: {{}}, handler: () => {{ try {{ read(2); return false; }} catch {{ return true; }} }} }}),
  nullableError: action({{ input: {{}}, handler: () => {{ try {{ nullable(null); return false; }} catch {{ return true; }} }} }})
}} }});
"#)).unwrap();
    let content = build_wp(tmp.path());
    let actual = php(
        r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$result = [];
foreach (['probe', 'dynamicError', 'nullableError'] as $key) {
  $fn = '\\FirstApp\\' . $schema['actions'][$key]['handler'];
  $result[] = $fn(new \First\JsObject(), new \First\JsObject());
}
echo \First\Js::jsonStringify($result);
"#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-js-values/first/app"),
        ],
    );
    assert_eq!(actual, json!([expected, true, true]));

    // The nonempty proof belongs to the container and must disappear through aliases.
    std::fs::write(
        tmp.path().join("first.config.ts"),
        r#"
import { action, defineConfig } from 'first';
export default defineConfig({ actions: { probe: action({ input: {}, handler: (): string => {
  const values = Array.from(['first']);
  const alias = values;
  alias.pop();
  return values[0];
} }) } });
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
        tmp.path().join("first/helpers.mjs"),
        "export function change(values) { const push = [].push; push.call(values, 'x'); }",
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        r#"
import { action, defineConfig } from 'first';
import { change } from './first/helpers.mjs';
export default defineConfig({ actions: { probe: action({ input: {}, handler: (): number => {
  const values: number[] = [1];
  change(values);
  return values.reduce((sum, value) => sum + value, 0);
} }) } });
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
        write_app(tmp.path().join("first/helpers.mjs"),
            format!("function mutate({parameters}) {{ const method = 'apply'; const copied = {copied}; copied{field} = 'x'; }} export function change(values) {{ mutate({argument}); }}"),
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("first.config.ts"),
            r#"
import { action, defineConfig } from 'first';
import { change } from './first/helpers.mjs';
export default defineConfig({ actions: { probe: action({ input: {}, handler: (): number => {
  const object = { count: 1 };
  const values = [object, object];
  change(values);
  return object.count + 1;
} }) } });
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
            tmp.path().join("first").join(file),
        )
        .unwrap();
    }
    let node = Command::new("node")
        .current_dir(tmp.path())
        .args([
            "--input-type=module",
            "-e",
            "import * as cases from './first/binary.mjs'; const out = {}; for (const [name, run] of Object.entries(cases)) out[name] = await run(); process.stdout.write(JSON.stringify(out));",
        ])
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let names: Vec<&String> = expected.as_object().unwrap().keys().collect();
    assert!(names.len() >= 14, "{expected}");
    let actions: Vec<String> = names
        .iter()
        .map(|name| format!("{name}: action({{ input: {{}}, handler: async () => await {name}() }})"))
        .collect();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        format!(
            "import {{ action, defineConfig }} from 'first';\nimport {{ {} }} from './first/binary.mjs';\nexport default defineConfig({{ name: 'binary-tests', actions: {{ {} }} }});\n",
            names.iter().map(|name| name.as_str()).collect::<Vec<_>>().join(", "),
            actions.join(", ")
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
            $fn = '\\FirstApp\\' . $action['handler'];
            try { $out[$name] = $fn(new \First\JsObject(), new \First\JsObject()); }
            catch (\Throwable $e) { $out[$name] = get_class($e) . ': ' . $e->getMessage(); }
        }
        echo \First\Js::jsonStringify(new \First\JsObject($out));
    "#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-binary-tests/first/app"),
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
        $bytes = \First\JsTypedArray::fromBytes('ab');
        try { \First\JsBinary::refuseWire(new \First\JsObject(['v' => new \First\JsArray([$bytes])]), 'action a'); echo 'null'; }
        catch (\First\JsError $e) { echo json_encode([$e->jsName, $e->getMessage()]); }
    "#,
        &[&content.join("plugins/first-runtime/first/bootstrap.php")],
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
        write_app(tmp.path().join("first").join(file), source).unwrap();
        std::fs::write(
            tmp.path().join("first.config.ts"),
            format!("import {{ action, defineConfig }} from 'first';\nimport {{ make }} from './first/{file}';\nexport default defineConfig({{ actions: {{ probe: action({{ handler: () => {{ make(); return 1; }} }}) }} }});\n"),
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
        tmp.path().join("first/async.mjs"),
    )
    .unwrap();
    let script = format!(
        "import * as m from './first/async.mjs'; const out = []; for (const name of {cases:?}) out.push(await m[name]()); await new Promise((r) => setTimeout(r, 0)); process.stdout.write(JSON.stringify(out));"
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
        .map(|name| format!("  {name}: action({{ input: {{}}, handler: async () => await {name}() }}),"))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(
        tmp.path().join("first.config.ts"),
        format!(
            "import {{ action, defineConfig }} from 'first';\nimport {{ {} }} from './first/async.mjs';\nexport default defineConfig({{ name: 'async-diff', actions: {{\n{actions}\n}} }});\n",
            cases.join(", ")
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
  $fn = '\\FirstApp\\' . $schema['actions'][$key]['handler'];
  $result[] = $fn(new \First\JsObject(), new \First\JsObject());
}}
echo \First\Js::jsonStringify(new \First\JsArray($result));
"#,
            serde_json::to_string(&cases).unwrap()
        ),
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-async-diff/first/app"),
        ],
    );
    assert_eq!(actual, expected);

    // Handler end: an unhandled rejection and a promise nothing can settle are runtime errors.
    write_app(tmp.path().join("first/async.mjs"),
        "export async function lost() { Promise.reject(new Error('lost')); return 1; }\nexport async function stuck() { await new Promise(() => {}); }\n",
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        "import { action, defineConfig } from 'first';\nimport { lost, stuck } from './first/async.mjs';\nexport default defineConfig({ name: 'async-diff', actions: {\n  lost: action({ input: {}, handler: async () => await lost() }),\n  stuck: action({ input: {}, handler: async () => await stuck() }),\n} });\n",
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
  $fn = '\\FirstApp\\' . $schema['actions'][$key]['handler'];
  try { $fn(new \First\JsObject(), new \First\JsObject()); $result[] = 'completed'; }
  catch (\First\JsError $e) { $result[] = $e->getMessage(); }
}
echo json_encode($result);
"#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-async-diff/first/app"),
        ],
    );
    assert_eq!(
        errors,
        json!([
            "lost",
            "This promise can never settle: nothing left to run (awaited at first.config.ts:5:51)"
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
    std::fs::write(tmp.path().join("first.config.ts"), format!(r#"
import {{ collection, text, json, action, defineConfig }} from "first";
const measured = {expression};
const notes = collection({{ title: text(), result: json().default(measured).optional() }}, {{ title: "title" }});
export default defineConfig({{ name: "differences", collections: {{ notes }}, actions: {{ measure: action({{ input: {{}}, handler: () => {expression} }}) }} }});
"#)).unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\FirstApp\\' . $schema['actions']['measure']['handler'];
        echo \First\Js::jsonStringify([\First\Js::decodeJson($schema['collections']['notes']['columns']['result']['default']['json']), $fn(new \First\JsObject(), \First\Seam::ctx(['user' => null]))]);
    "#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-differences/first/app"),
        ],
    );
    assert_eq!(
        result,
        json!([
            [{"nested":{"keep":1},"slots":[null]}, "undefined", "object", "a", 2, "a", ["x"], false, 2, "undefined"],
            [{"nested":{"keep":1},"slots":[null]}, "undefined", "object", "a", 2, "a", ["x"], false, 2, "undefined"]
        ])
    );
    std::fs::write(tmp.path().join("first.config.ts"), r#"const half = "🙂a".slice(1);"#).unwrap();
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
            "first/probe.cjs",
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
        "process.stdout.write(JSON.stringify(require('./first/probe.cjs')('src/*.test.js')));",
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
        tmp.path().join("first.config.ts"),
        r#"
import { action, defineConfig, text } from "first";
import run from "./first/probe.cjs";
export default defineConfig({ name: "commonjs", actions: { probe: action({ access: "anyone", input: { glob: text() }, handler: (input) => run(input.glob) }) } });
"#,
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\FirstApp\\' . $schema['actions']['probe']['handler'];
        echo \First\Js::jsonStringify($fn(new \First\JsObject(['glob' => 'src/*.test.js']), \First\Seam::ctx(['user' => null])));
    "#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-commonjs/first/app"),
        ],
    );
    assert_eq!(result, expected);
}

#[test]
fn classes_match_node_through_generated_php_and_wire_client_types() {
    let tmp = tempfile::tempdir().unwrap();
    let config = root().join("tests/differential/classes.ts");
    std::fs::copy(&config, tmp.path().join("first.config.ts")).unwrap();
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
    let runtime = content.join("plugins/first-runtime/first/bootstrap.php");
    let app = content.join("plugins/first-app-class-tests/first/app");
    let actual = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $out = [];
        foreach ($schema['actions'] as $name => $action) {
            $fn = '\\FirstApp\\' . $action['handler'];
            try { $out[$name] = ['data' => $fn()]; }
            catch (\Throwable $e) { $out[$name] = ['error' => $e->getMessage()]; }
        }
        echo \First\Js::jsonStringify($out);
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
        $fn = '\\FirstApp\\' . $schema['actions']['classesWire']['handler'];
        $instance = $fn();
        $stored = \First\Seam::toPhp($instance, ['type' => 'json']);
        $input = \First\Seam::toJs($stored, ['type' => 'json']);
        $stored->p['count'] = 99;
        echo \First\Js::jsonStringify([
            'wire' => \First\Seam::toWire($instance),
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
import type { Actions } from './first/_generated/client/types';
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
            $fn = '\\FirstApp\\' . $action['handler'];
            try { $out[$name] = ['data' => $fn()]; }
            catch (\Throwable $e) { $out[$name] = ['error' => $e->getMessage()]; }
        }
        echo \First\Js::jsonStringify($out);
    "#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-class-private/first/app"),
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
        let input = if message == "JSON schemas cannot use class instance types" {
            "{ value: json<C>().optional() }"
        } else {
            "{}"
        };
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{ table, json, action, defineConfig }} from 'first';\n{declarations}\nexport default defineConfig({{ tables: {{ n: table({{}}) }}, actions: {{ test: action({{input: {input}, handler: () => {handler} }}) }} }});\n")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{message}: {report}");
        let diagnostic = report["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["message"].as_str().unwrap().contains(message))
            .unwrap_or_else(|| panic!("expected {message}: {report}"));
        assert_eq!(diagnostic["location"]["file"], "first.config.ts", "{report}");
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
    std::fs::write(js.join("first.config.mjs"), module).unwrap();
    std::fs::copy(dir.join("host-crypto.cjs"), js.join("host-crypto.cjs")).unwrap();
    // Node reads the origin directly; the PHP side sees the same answers through the stub.
    let node = Command::new("node")
        .arg(dir.join("run-node.mjs"))
        .arg(js.join("first.config.mjs"))
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
    $fn = '\\FirstApp\\' . $action['handler'];
    try { $out[$name] = ['data' => $fn(new \First\JsObject(), \First\Seam::ctx(['user' => null]))]; }
    catch (\Throwable $e) { $out[$name] = ['error' => $e->getMessage()]; }
}
echo \First\Js::jsonStringify($out);
"#,
        ])
        .arg(content.join("plugins/first-runtime/first/bootstrap.php"))
        .arg(content.join("plugins/first-app-host-globals/first/app"))
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

/// `first check --json` reports each plugin's package, integrity, locked and inferred grant, and
/// the handlers that read data and send it out. A report, not a refusal: the check succeeds.
#[test]
fn check_reports_plugin_grants_and_read_to_send_flows() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(tmp.path().join("node_modules/first-plugin-sync/src")).unwrap();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        r#"import { collection, defineConfig, text } from "first";
import sync from "first-plugin-sync";
const posts = collection({ title: text() }, { title: "title" });
export default defineConfig({ name: "flows", collections: { posts }, use: [sync()] });"#,
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("node_modules/first-plugin-sync/package.json"),
        r#"{ "name": "first-plugin-sync", "version": "3.1.0", "exports": "./src/index.ts" }"#,
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("node_modules/first-plugin-sync/src/index.ts"),
        r#"import { action, db, definePlugin } from "first";
import { abilities, esc_html } from "php/wordpress";
import { createHmac } from "node:crypto";
// The send happens in a helper the handler calls with what it read. Package TypeScript compiles
// as checked JavaScript, where awaiting a helper's result isn't supported, so the helper awaits.
async function push(body: string) {
  const response = await fetch("https://hooks.example.com/in", { method: "POST", body: String(body), headers: { authorization: process.env.SYNC_KEY ?? "", "x-signature": createHmac("sha256", process.env.SYNC_SIGNING!).update(body).digest("hex") } });
  return response.status;
}
export default () => definePlugin({
  name: "sync",
  actions: {
    export: action({ input: {}, async handler() { const rows = await db.query.posts.findMany(); push(JSON.stringify(rows)); return true; } }),
    count: action({ input: {}, async handler() { return (await db.query.posts.findMany()).length; } }),
    // A WordPress ability is a capability like any other: here the app's own `posts` list.
    list: action({ input: {}, async handler() { const rows = await abilities.call("flows/posts-list", {}); return rows; } }),
    // So is a WordPress function, recorded with the module it comes from.
    title: action({ input: {}, handler() { return esc_html("<b>"); } }),
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
    assert_eq!(plugin["package"], "first-plugin-sync");
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
    assert!(!tmp.path().join("first/_generated").exists(), "check writes no lock");
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
            .contains("plugin \"sync\" (first-plugin-sync@3.1.0) isn't in first/_generated/plugins.lock.json"),
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
    // Every type-level construct here is refused in authored code or exceeds First's type subset.
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
        tmp.path().join("first.config.ts"),
        r#"
import { action, defineConfig, text } from 'first';
import { run } from 'typed-lib';
export default defineConfig({ name: 'typed-lib', actions: {
  probe: action({ input: { key: text() }, handler: (input) => run(input.key) }),
} });
"#,
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let actual = php(
        r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$fn = '\\FirstApp\\' . $schema['actions']['probe']['handler'];
$input = new \First\JsObject();
$input->p['key'] = 'hi';
echo \First\Js::jsonStringify($fn($input, new \First\JsObject()));
"#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-typed-lib/first/app"),
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
            "`Mapper` comes from an installed package or JavaScript module, whose types First erases",
        ),
        (
            "import { run, type Mapper } from 'typed-lib'; const read = (key: string) => { const map: Mapper | null = null; return run(key); };",
            "`Mapper` comes from an installed package or JavaScript module, whose types First erases",
        ),
    ] {
        std::fs::write(
            tmp.path().join("first.config.ts"),
            format!(
                "import {{ action, defineConfig, text }} from 'first'; {source} export default defineConfig({{ actions: {{ probe: action({{ input: {{ key: text() }}, handler: (input) => read(input.key) }}) }} }});"
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
        tmp.path().join("first/helper.js"),
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
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first'; import {test} from './first/helper.js'; export default defineConfig({name:'classboundary',actions:{test:action({input:{},handler:()=>test()})}});").unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/first-app-classboundary/first/app");
    let actual = php(
        r#"
        require $argv[1];
        require $argv[2] . '/functions.php';
        echo \First\Js::jsonStringify(\FirstApp\action__test());
    "#,
        &[&content.join("plugins/first-runtime/first/bootstrap.php"), &app],
    );
    let node = Command::new("node")
        .current_dir(tmp.path())
        .args([
            "--input-type=module",
            "-e",
            "import {test} from './first/helper.js'; process.stdout.write(JSON.stringify(test()));",
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
// Built-in prototypes carry well-known symbol methods First doesn't model: refused, not guessed.
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
    write_app(tmp.path().join("first/helpers.mjs"), helper).unwrap();
    let node = Command::new("node")
        .current_dir(tmp.path())
        .args([
            "--input-type=module",
            "-e",
            "import {probe} from './first/helpers.mjs'; process.stdout.write(JSON.stringify(probe()));",
        ])
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        "import { action, defineConfig } from 'first'; import { probe, unmodeled } from './first/helpers.mjs'; export default defineConfig({ name: 'symbols', actions: { probe: action({ input: {}, handler: () => probe() }), unmodeled: action({ input: {}, handler: () => unmodeled() }) } });",
    )
    .unwrap();
    let content = build_wp(tmp.path());
    let actual = php(
        r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$run = fn ($name) => ('\\FirstApp\\' . $schema['actions'][$name]['handler'])(new \First\JsObject(), new \First\JsObject());
echo \First\Js::jsonStringify(new \First\JsArray([$run('probe'), $run('unmodeled')]));
"#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-symbols/first/app"),
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
            "const s = Symbol('x'); export default defineConfig({ actions: { a: action({ input: {}, handler: () => typeof s }) } });",
            "symbols aren't supported in TypeScript code yet",
        ),
        (
            "export default defineConfig({ actions: { a: action({ input: {}, handler: () => typeof Symbol.for('x') }) } });",
            "symbols aren't supported in TypeScript code yet",
        ),
        (
            "export default defineConfig({ actions: { a: action({ input: {}, handler: () => { const m = new WeakMap(); return 1; } }) } });",
            "`new WeakMap` isn't supported",
        ),
        (
            "const m = new WeakMap(); export default defineConfig({ actions: { a: action({ input: {}, handler: () => typeof m }) } });",
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
            "export default defineConfig({ actions: { a: action({ input: {}, handler: () => typeof globalThis.Buffer }) } });",
            "`globalThis.Buffer` depends on the host",
        ),
        (
            "export default defineConfig({ actions: { a: action({ input: {}, handler: () => typeof globalThis.myPolyfill }) } });",
            "`globalThis.myPolyfill` depends on the host",
        ),
        (
            "const f = typeof globalThis.fetch; export default defineConfig({});",
            "`globalThis.fetch` depends on the host",
        ),
        (
            "export default defineConfig({ actions: { a: action({ input: {}, handler: () => globalThis.Bun() }) } });",
            "`globalThis.Bun` is undefined in First",
        ),
    ] {
        std::fs::remove_file(tmp.path().join("first/helpers.mjs")).ok();
        std::fs::write(
            tmp.path().join("first.config.ts"),
            format!("import {{ action, defineConfig }} from 'first';\n{source}"),
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
                write_app(tmp.path().join("first").join(name), source.as_str().unwrap()).unwrap();
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
        actions.push(format!("{name}: action({{ input: {{}}, handler: () => ({body}) }})"));
        if v["fold"] == true {
            declarations.push_str(&format!("const folded_{name} = {expression};\n"));
            actions.push(format!(
                "folded_{name}: action({{ input: {{}}, handler: () => folded_{name} }})"
            ));
        }
    }
    write_app(tmp.path().join("first/helper.js"), javascript).unwrap();
    // The app and its helper modules live under first/; the root config re-exports it.
    let entry = tmp.path().join("first/app.ts");
    std::fs::write(&entry, format!("import {{ action, defineConfig }} from 'first';\n{declarations}\nexport default defineConfig({{name: 'builtinparity', actions: {{{}}}}});", actions.join(",\n"))).unwrap();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        "export { default } from './first/app.ts';\n",
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
    let app = content.join("plugins/first-app-builtinparity/first/app");
    let actual = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $out = new \First\JsObject();
        foreach ($schema['actions'] as $name => $action) {
            $fn = '\FirstApp\\' . $action['handler'];
            $out->p[$name] = new \First\JsObject(['data' => $fn(new \First\JsObject(), \First\Seam::ctx(['user' => null]))]);
        }
        echo \First\Js::jsonStringify($out);
    "#,
        &[&content.join("plugins/first-runtime/first/bootstrap.php"), &app],
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
        "typeof process",
        "typeof require",
        "typeof crypto",
        "typeof globalThis.process",
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
            std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action, defineConfig}} from 'first';\n{declaration}\nexport default defineConfig({{name:'refusal',actions:{{probe:action({{input:{{}},handler:()=>{result}}})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action,defineConfig}} from 'first';export default defineConfig({{actions:{{probe:action({{handler:()=>{expression}}})}}}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{expression}: {report}");
        let diagnostic = &report["diagnostics"][0];
        assert_eq!(diagnostic["category"], "invalid-source", "{report}");
        assert_eq!(diagnostic["code"], "F1001", "{report}");
        assert!(
            diagnostic["message"].as_str().unwrap().starts_with("syntax error:"),
            "{report}"
        );
        assert_eq!(diagnostic["location"]["file"], "first.config.ts");
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action, defineConfig}} from 'first';\nexport default defineConfig({{name:'diagnostics',actions:{{probe:action({{input:{{}},handler:()=>{{ {source} }} }})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action, defineConfig}} from 'first';\nconst result = {expression};\nexport default defineConfig({{name:'coercion',actions:{{probe:action({{input:{{}},handler:()=>result}})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action, defineConfig, table, db}} from 'first';\nconst notes = table({{}});\nexport default defineConfig({{name:'queryarity',tables:{{notes}},actions:{{probe:action({{input:{{}},handler:async()=>{{let n=0; await db.query.notes.{method}({{}}, n++); return n;}}}})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action, defineConfig, table, integer, db}} from 'first';\nconst notes=table({{count:integer().optional()}});\nexport default defineConfig({{name:'builderarity',tables:{{notes}},actions:{{probe:action({{input:{{}},handler:async()=>{{let n=0; await {expression}; return n;}}}})}}}});")).unwrap();
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
            \First\Js::parseInt('120101100002111211120012010111012200200201', 3);
            echo json_encode(['accepted']);
        } catch (\First\JsError $error) {
            echo json_encode([$error->jsName, $error->getMessage()]);
        }
    "#,
        &[&root().join("runtime/First/bootstrap.php")],
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action, defineConfig}} from 'first';\nconst value = (() => {{try {{ {expression}; return 0; }} catch (e) {{ return 1; }} }})();\nexport default defineConfig({{actions:{{probe:action({{input:{{}},handler:()=>value}})}}}});" )).unwrap();
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
        "action({handler:()=>1}, 1)",
        "new HttpError(400, 'bad', 'message')",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{text, json, select, action, defineConfig, HttpError}} from 'first';\nconst invalid = {expression};\nexport default defineConfig({{actions:{{probe:action({{handler:()=>1}})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action,defineConfig}} from 'first';\n{source}\nexport default defineConfig({{actions:{{probe:action({{handler:()=>result}})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action,defineConfig}} from 'first';\n{declaration}\nexport default defineConfig({{actions:{{probe:action({{handler:()=>{body}}})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action,defineConfig}} from 'first';\nconst folded={expression};\nexport default defineConfig({{actions:{{probe:action({{handler:()=>folded}})}}}});")).unwrap();
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
    let entry = tmp.path().join("first.config.ts");
    std::fs::write(&entry, "import {action,defineConfig} from 'first'; export default defineConfig({name:'logresult',actions:{probe:action({input:{},handler:()=>{const result=console.warn('builtin-return-marker');return [typeof result,result===undefined,result===null];}})}});").unwrap();
    let node = Command::new("node")
        .arg(root().join("tests/differential/run-node.mjs"))
        .arg(&entry)
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    assert!(String::from_utf8_lossy(&node.stderr).contains("builtin-return-marker"));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/first-app-logresult/first/app");
    let actual = Command::new("php").args(["-r", r#"require $argv[1]; $schema=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\FirstApp\\'.$schema['actions']['probe']['handler'];echo \First\Js::jsonStringify($fn());"#]).arg(content.join("plugins/first-runtime/first/bootstrap.php")).arg(app).output().unwrap();
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
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first'; const power=(base:number,exponent:number)=>Math.pow(base,exponent); const log=(value:number)=>Math.log(value); const exp=(value:number)=>Math.exp(value); export default defineConfig({name:'powerrefusal',actions:{probe:action({handler:()=>{const out:string[]=[];try{power(3,35);}catch{out.push('power');}try{power(45.29,-1);}catch{out.push('reciprocal');}try{log(3);}catch{out.push('log');}try{exp(1);}catch{out.push('exp');}return out;}})}});").unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$schema=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\FirstApp\\'.$schema['actions']['probe']['handler'];echo \First\Js::jsonStringify($fn());"#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-powerrefusal/first/app"),
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action,defineConfig}} from 'first';\nconst folded={expression};\nexport default defineConfig({{actions:{{probe:action({{handler:()=>folded}})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{json,action,defineConfig}} from 'first';\nexport default defineConfig({{actions:{{probe:action({{input:{{values:json<{annotation}>()}},handler:(input)=>input.values}})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action,defineConfig}} from 'first';\nexport default defineConfig({{actions:{{probe:action({{handler:()=>({expression})}})}}}});" )).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action,defineConfig}} from 'first';\nexport default defineConfig({{actions:{{probe:action({{handler:()=>({expression})}})}}}});" )).unwrap();
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
    write_app(tmp.path().join("first/helper.js"), "export function probe(){const key='__proto__';const a=[];try {a[key]=1;} catch(e) {return [e.name,Object.hasOwn(a,key)];} return ['accepted'];}").unwrap();
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first';import {probe} from './first/helper.js';export default defineConfig({name:'prototyperefusal',actions:{probe:action({handler:()=>probe()})}});").unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$s=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\\FirstApp\\'.$s['actions']['probe']['handler'];echo \First\Js::jsonStringify($fn(new \First\JsObject(), \First\Seam::ctx(['user'=>null])));"#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-prototyperefusal/first/app"),
        ],
    );
    assert_eq!(result, json!(["TypeError", false]));
}

#[test]
fn function_string_conversion_is_refused_at_known_and_dynamic_boundaries() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first';\nexport default defineConfig({actions:{probe:action({handler:()=>String(()=>1)})}});").unwrap();
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1), "{report}");
    assert_eq!(
        report["diagnostics"][0]["message"],
        "function string coercion isn't supported"
    );
    assert_eq!(report["diagnostics"][0]["location"]["line"], 2);
    write_app(tmp.path().join("first/helper.js"),
        "function convert(value){return String(value);} export function probe(){try{return convert(()=>1);}catch(e){return e.name;}}",
    )
    .unwrap();
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first';import {probe} from './first/helper.js';export default defineConfig({name:'functionrefusal',actions:{probe:action({handler:()=>probe()})}});").unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$s=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\\FirstApp\\'.$s['actions']['probe']['handler'];echo \First\Js::jsonStringify($fn(new \First\JsObject(),\First\Seam::ctx(['user'=>null])));"#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-functionrefusal/first/app"),
        ],
    );
    assert_eq!(result, "TypeError");
}

#[test]
fn non_iso_date_literals_are_refused_at_the_call() {
    for text in ["2020-1-1", "-000000-01-01"] {
        for name in ["first.config.ts", "first/helper.js"] {
            let tmp = tempfile::tempdir().unwrap();
            if name == "first/helper.js" {
                write_app(
                    tmp.path().join(name),
                    format!("export const probe=()=>new Date({text:?}).getTime();"),
                )
                .unwrap();
                std::fs::write(tmp.path().join("first.config.ts"),"import {action,defineConfig} from 'first';import {probe} from './first/helper.js';export default defineConfig({actions:{probe:action({handler:()=>probe()})}});").unwrap();
            } else {
                std::fs::write(tmp.path().join(name),format!("import {{action,defineConfig}} from 'first';export default defineConfig({{actions:{{probe:action({{handler:()=>new Date({text:?}).getTime()}})}}}});")).unwrap();
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
    write_app(tmp.path().join("first/helper.js"), "export function probe(){try{arguments.callee;}catch(e){return [Object.hasOwn(e,'name'),Object.hasOwn(e,'message'),Object.keys(e)];}}").unwrap();
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first';import {probe} from './first/helper.js';const folded=probe();export default defineConfig({actions:{probe:action({handler:()=>folded})}});").unwrap();
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1), "{report}");
    assert_eq!(
        report["diagnostics"][0]["message"],
        "restricted arguments properties aren't supported during configuration evaluation"
    );
    assert_eq!(report["diagnostics"][0]["location"]["file"], "first/helper.js");
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
        std::fs::write(tmp.path().join("first.config.ts"),format!("import {{action,defineConfig}} from 'first';\nexport default defineConfig({{name:'undefinedflow',actions:{{probe:action({{input:{{}},handler:()=>{{{body}}}}})}}}});" )).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action, defineConfig}} from 'first';\nexport default defineConfig({{name:'boundaries',actions:{{probe:action({{input:{{}},handler:()=>{{ {source} }} }})}}}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{source}: {report}");
        let d = &report["diagnostics"][0];
        assert!(d["message"].as_str().unwrap().contains(message), "{source}: {report}");
        assert_eq!(d["location"]["file"], "first.config.ts");
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
                    tmp.path().join("first/helper.js"),
                    format!("export function probe(){{{body}}}"),
                )
                .unwrap();
                "probe".to_string()
            } else {
                format!("()=>{{{body}}}")
            };
            let import = if javascript {
                "import {probe} from './first/helper.js';"
            } else {
                ""
            };
            std::fs::write(tmp.path().join("first.config.ts"),format!("import {{action,defineConfig}} from 'first';{import}export default defineConfig({{actions:{{probe:action({{handler:{handler}}})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"),format!("import {{action,defineConfig}} from 'first';export default defineConfig({{actions:{{probe:action({{handler:()=>{{function f(v:number|null){{return typeof Number(v);}}{source}return 0;}}}})}}}});")).unwrap();
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
    write_app(tmp.path().join("first/helper.js"), "function read(value,key){try{return ['accepted',typeof value[key]];}catch(e){return [e.name,e.message];}}function get(value,key){return value[key];}export function probe(){const a=[];a.custom=2;return [read(new Set(),'union'),read([],'copyWithin'),typeof get({},'missing'),get(a,'custom'),typeof get('ab','flags')];}").unwrap();
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first';import {probe} from './first/helper.js';export default defineConfig({name:'nativeproperties',actions:{probe:action({handler:()=>probe()})}});").unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$s=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\\FirstApp\\'.$s['actions']['probe']['handler'];echo \First\Js::jsonStringify($fn(new \First\JsObject(), \First\Seam::ctx(['user'=>null])));"#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-nativeproperties/first/app"),
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
    std::fs::write(tmp.path().join("first.config.ts"), r#"
import {action,defineConfig} from 'first';
export default defineConfig({name:'typeddatareads',actions:{probe:action({handler:()=>{
    const o:Record<string,undefined>={};
    const key='to'+'String';
    const optional:{toString?:undefined}={};
    const cases=[()=>typeof o.toString,()=>typeof o['valueOf'],()=>typeof o[key],()=>{const {toString}=o;return typeof toString;},()=>typeof optional.toString,()=>typeof optional['toString'],()=>{const n:Record<string,number>={};n.valueOf ||=1;return typeof 0;}];
    return cases.map(f=>{try{return ['accepted',f()];}catch(e){return [e.name,e.message];}});
}})}});
"#).unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$s=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\\FirstApp\\'.$s['actions']['probe']['handler'];echo \First\Js::jsonStringify($fn(new \First\JsObject(), \First\Seam::ctx(['user'=>null])));"#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-typeddatareads/first/app"),
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
            first::builtins::contract(&surface, &name).is_some(),
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
                    tmp.path().join("first/helper.js"),
                    format!("export function probe(){{{source}return 0;}}"),
                )
                .unwrap();
                "import {probe} from './first/helper.js';export default defineConfig({actions:{probe:action({handler:()=>probe()})}});".to_string()
            } else {
                format!("{source}export default defineConfig({{actions:{{probe:action({{handler:()=>0}})}}}});")
            };
            std::fs::write(
                tmp.path().join("first.config.ts"),
                format!("import {{action,defineConfig}} from 'first';{body}"),
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
        std::fs::write(tmp.path().join("first.config.ts"),format!("import {{action,defineConfig}} from 'first';export default defineConfig({{actions:{{probe:action({{handler:()=>{{{declaration}const v=({access}+=1);return [String(v),`${{v}}`];}}}})}}}});")).unwrap();
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
        "import {n as undefined} from './first/binding-helper.js';String(undefined);",
        "import undefined from './first/binding-helper.js';String(undefined);",
        "import * as undefined from './first/binding-helper.js';String(undefined);",
    ] {
        for javascript in [false, true] {
            let tmp = tempfile::tempdir().unwrap();
            write_app(
                tmp.path().join("first/binding-helper.js"),
                "export const n=3;export default 3;",
            )
            .unwrap();
            let body = if javascript {
                write_app(
                    tmp.path().join("first/binding-probe.js"),
                    format!("{source}export function probe(){{return 0;}}"),
                )
                .unwrap();
                "import {probe} from './first/binding-probe.js';export default defineConfig({actions:{probe:action({handler:()=>probe()})}});".to_string()
            } else {
                format!("{source}export default defineConfig({{actions:{{probe:action({{handler:()=>0}})}}}});")
            };
            std::fs::write(
                tmp.path().join("first.config.ts"),
                format!("import {{action,defineConfig}} from 'first';{body}"),
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
        std::fs::write(tmp.path().join("first.config.ts"),format!("import {{action,defineConfig}} from 'first';export default defineConfig({{actions:{{probe:action({{handler:()=>{{{source}}}}})}}}});")).unwrap();
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
            std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action,defineConfig}} from 'first';{declaration}export default defineConfig({{actions:{{probe:action({{handler:()=>{result}}})}}}});")).unwrap();
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
    write_app(tmp.path().join("first/helper.js"), "class Base {cause(){}} class Options extends Base {} export function read(){try{return Object.hasOwn(new Error('x',new Options()),'cause');}catch(e){return [e.name,e.message];}}").unwrap();
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first';import {read} from './first/helper.js';class Base {cause(){}} class Options extends Base {} export default defineConfig({name:'errorcause',actions:{test:action({input:{},handler:()=>{let typed:string[]=[];try{Object.hasOwn(new Error('x',new Options()),'cause');}catch(e){typed=[e.name,e.message];}return [typed,read()];}})}});").unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/first-app-errorcause/first/app");
    let actual = php(
        r#"
        require $argv[1];
        require $argv[2] . '/functions.php';
        echo \First\Js::jsonStringify(\FirstApp\action__test());
    "#,
        &[&content.join("plugins/first-runtime/first/bootstrap.php"), &app],
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
            "first/counter.js",
            "export let value=0;export function inc(){value++;}",
            "import {value,inc} from './first/counter.js';",
        ),
        (
            "first/counter.ts",
            "let counter=0;export {counter as value};export function inc(){counter++;}",
            "import {value,inc} from './first/counter.ts';",
        ),
        (
            "first/counter.js",
            "export var value=0;export function inc(){value++;}",
            "import * as counter from './first/counter.js';const {value,inc}=counter;",
        ),
        (
            "first/counter.js",
            "let value=0;export {value as default};export function inc(){value++;}",
            "import value,{inc} from './first/counter.js';",
        ),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        write_app(tmp.path().join(file), source).unwrap();
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action,defineConfig}} from 'first';{import}inc();const folded=value;export default defineConfig({{actions:{{probe:action({{handler:()=>folded}})}}}});")).unwrap();
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
        tmp.path().join("first/array-overrides.js"),
        "export function installArrayOverrides(a,b){a.map=()=>[99];b.join=()=>'own';}",
    )
    .unwrap();
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first';import {installArrayOverrides} from './first/array-overrides.js';export default defineConfig({name:'arraynative',actions:{test:action({input:{},handler:()=>{const a=[1,2],b=[1,2];installArrayOverrides(a,b);let mapped:string[]=[];let joined:string[]=[];try{a.map(x=>x+1);}catch(e){mapped=[e.name,e.message];}try{b.join('-');}catch(e){joined=[e.name,e.message];}return [mapped,joined];}})}});").unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/first-app-arraynative/first/app");
    let actual = php(
        r#"
        require $argv[1];
        require $argv[2] . '/functions.php';
        echo \First\Js::jsonStringify(\FirstApp\action__test());
    "#,
        &[&content.join("plugins/first-runtime/first/bootstrap.php"), &app],
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
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first';const folded=(()=>{for(var [x] of [[1]])return x;return 0;})();export default defineConfig({actions:{probe:action({handler:()=>folded})}});").unwrap();
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1), "{report}");
    let diagnostic = &report["diagnostics"][0];
    assert_eq!(
        diagnostic["message"], "destructured var loops aren't supported yet",
        "{report}"
    );
    assert_eq!(diagnostic["location"]["file"], "first.config.ts", "{report}");
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action,defineConfig}} from 'first';{declaration}export default defineConfig({{actions:{{probe:action({{handler:()=>folded}})}}}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(0), "{declaration}: {report}");
    }
    // Strict JavaScript throws on a write to the name, so it is refused where it is written.
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first';\nconst f=function g(){ g = () => 1; return 1; };\nexport default defineConfig({actions:{probe:action({handler:()=>f()})}});").unwrap();
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
        tmp.path().join("first/h.mjs"),
        "export const run = () => { const fn = function f(x = (f = () => 1)) { return x; }; return fn(); };\n",
    )
    .unwrap();
    std::fs::write(tmp.path().join("first.config.ts"), "import {action,defineConfig} from 'first';\nimport { run } from './first/h.mjs';\nexport default defineConfig({actions:{probe:action({handler:()=>run()})}});").unwrap();
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
/// compiler and for tsc (first/_generated/db.d.ts), and the compiled handler calls `Call::run` with the input as
/// a JS value, using the typed result. `Call::run` itself runs on WordPress in tests/php/abilities_test.php.
#[test]
fn wordpress_abilities_are_typed_from_the_lock_and_the_schema() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("calls");
    copy_dir(&root().join("tests/fixtures/abilities-call"), &project);
    let content = build_wp(&project);
    let plugin = content.join("plugins/first-app-calls/first/app/functions.php");
    // Stand in for WordPress: record each call and answer as the ability would.
    let stub = tmp.path().join("call.php");
    std::fs::write(
        &stub,
        r#"<?php
        namespace First\Wp\Abilities;
        final class Call {
            public static array $seen = [];
            public static function run(string $name, mixed $input): mixed {
                self::$seen[] = [$name, \First\Js::jsonStringify($input)];
                return $name === 'acme/site-info' ? new \First\JsObject(['value' => 'first site']) : 'hi ada';
            }
        }"#,
    )
    .unwrap();
    let got = php(
        r#"
        require $argv[1]; require $argv[2]; require $argv[3];
        $out = \FirstApp\action__relay(new \First\JsObject(['who' => 'ada']), null);
        echo json_encode(['out' => \First\Js::jsonTree($out), 'seen' => \First\Wp\Abilities\Call::$seen]);
    "#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
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
                "paths": { "first": [root().join("types/first/index.d.ts")], "php/wordpress": [root().join("types/first/wordpress.d.ts")] }
            },
            "files": ["first.config.ts", "first/_generated/db.d.ts"]
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
    let config = std::fs::read_to_string(project.join("first.config.ts")).unwrap();
    std::fs::write(
        project.join("first.config.ts"),
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
/// from their exports under `first/`, `like` reaches `notes` through `"first:db"`, and on an
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
            $row = $app->db->insert('notes', ['title' => 'First'], true)[0];
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
            $log = tempnam(sys_get_temp_dir(), 'first-hooks');
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
                "[first] first/wp-hooks/the_title: First\\JsError: broken title filter",
                "[first] first/wp-hooks/save_post: First\\JsError: saw Draft one #true",
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
    assert_eq!(got["subscriber"], json!([200, {"allowed": false}]));
    // An empty post is WordPress's `empty_content` WP_Error: 422 with its code; the option written
    // before it rolled back with the action's transaction.
    assert_eq!(got["empty"][0], 422);
    assert_eq!(got["empty"][1]["code"], "empty_content");
    assert_eq!(got["option"], "Fish & <chips>");
}

/// The compiler's own-app ability types and the runtime's registered abilities come from the same
/// schema; this runs both and compares names, input properties and required inputs, so a new
/// operation in runtime/First/Wp/Abilities/Register.php can't go untyped.
#[test]
fn wordpress_own_abilities_match_the_registered_ones() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("own");
    copy_dir(&root().join("tests/fixtures/abilities-own"), &project);
    let content = build_wp(&project);
    let program = first::loader::load(&project.join("first.config.ts")).unwrap();
    let built = first::pipeline::build(&project, &program, || Ok(first::pipeline::Previous::none()), |_| None).unwrap();
    let compiled: Value = serde_json::to_value(first::wordpress::abilities::own_inputs(&built.schema)).unwrap();
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("eval")
        .arg(&content)
        .arg(
            r#"
            $out = [];
            foreach (\First\Wp\Abilities\Register::operations() as $op) {
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
/// A helper, class, namespace receiver or captured collection that First refuses is reported
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
            tmp.path().join("first.config.ts"),
            format!("import {{ action, defineConfig }} from 'first';\n{declarations}\nexport default defineConfig({{ actions: {{ probe: action({{ input: {{}}, handler: {handler} }}) }} }});\n"),
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
            tmp.path().join("first.config.ts"),
            format!("import {{ action, defineConfig }} from 'first';\nexport default defineConfig({{ actions: {{ probe: action({{ input: {{}}, handler: () => {body} }}) }} }});\n"),
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
        let siblings: Vec<PathBuf> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| *path != config)
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
        let runtime = content.join("plugins/first-runtime/first/bootstrap.php");
        let app = content.join(format!("plugins/first-app-language-{name}/first/app"));
        let out = Command::new("php")
            .arg("-r")
            .arg(
                r#"
            require $argv[1];
            $schema = require $argv[2] . '/schema.php';
            require $argv[2] . '/functions.php';
            $out = [];
            foreach ($schema['actions'] as $name => $action) {
                $fn = '\\FirstApp\\' . $action['handler'];
                try { $out[$name] = ['data' => \First\Seam::toWire($fn(new \First\JsObject()))]; }
                catch (\Throwable $e) { $out[$name] = ['error' => $e->getMessage()]; }
            }
            echo \First\Js::jsonStringify(['schema' => 'first-differential', 'version' => 1, 'complete' => true, 'cases' => $out]);
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

/// Twelve objects that point at each other through six fields, then twelve member writes through
/// them. Every write reaches every object below every short field path, and alias expansion
/// within one pass once grew an event's place set to millions of places before the end-of-pass
/// widening check could see it: on this program the previous solver took more than 90 s and
/// 2.9 GB in a debug build. The solver now numbers each place once and widens a binding whose group
/// runs away inside a pass (docs/decisions/2026-11-12-effects-event-scale.md). Debug builds count
/// path projections (`FIRST_DEBUG_EFFECTS_WORK`); the solve must stay a small multiple of its
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
    std::fs::create_dir(tmp.path().join("first")).unwrap();
    std::fs::write(tmp.path().join("first/run.mjs"), body).unwrap();
    std::fs::write(tmp.path().join("package.json"), r#"{"type":"module"}"#).unwrap();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        r#"import { action, defineConfig, text } from "first";
import { run } from "./first/run.mjs";
export default defineConfig({ name: "graph", actions: { a: action({ access: "anyone", input: { s: text() }, async handler(input) { return { v: run(input.s) }; } }) } });
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
                .env("FIRST_DEBUG_EFFECTS", &dump)
                .env("FIRST_DEBUG_EFFECTS_WORK", &work)
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
            "import {{ run }} from './first/run.mjs'; process.stdout.write(JSON.stringify({}.map(s => ({{ v: run(s) }}))));",
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
$fn = '\\FirstApp\\' . $schema['actions']['a']['handler'];
$out = [];
foreach (json_decode('{}') as $s) {{
    $input = new \First\JsObject();
    $input->p['s'] = $s;
    $out[] = json_decode(\First\Js::jsonStringify($fn($input, new \First\JsObject())));
}}
echo json_encode($out);
"#,
            serde_json::to_string(&inputs).unwrap()
        ),
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-graph/first/app"),
        ],
    );
    assert_eq!(actual, expected);
}

/// A token parser shaped like picomatch's `parse()`: each branch writes through `prev`,
/// `prev.prev` and `prev.prev.prev`, so the effect places below those bindings multiply past
/// the solver's widening threshold. The solve restarts with them widened
/// (docs/decisions/2026-11-08-effects-widening.md). Debug builds name the widened bindings in
/// the `FIRST_DEBUG_EFFECTS` dump, which must be the same on every run, and the generated PHP
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
    std::fs::create_dir(tmp.path().join("first")).unwrap();
    std::fs::write(tmp.path().join("first/run.mjs"), body).unwrap();
    std::fs::write(tmp.path().join("package.json"), r#"{"type":"module"}"#).unwrap();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        r#"import { action, defineConfig, text } from "first";
import { run } from "./first/run.mjs";
export default defineConfig({ name: "tokens", actions: { a: action({ access: "anyone", input: { s: text() }, async handler(input) { return { v: run(input.s) }; } }) } });
"#,
    )
    .unwrap();

    if cfg!(debug_assertions) {
        let dump = |run: usize| {
            let file = tmp.path().join(format!("effects-{run}.txt"));
            let out = first()
                .args(["check", "--json"])
                .arg(tmp.path())
                .env("FIRST_DEBUG_EFFECTS", &file)
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
            "import {{ run }} from './first/run.mjs'; process.stdout.write(JSON.stringify({}.map(s => ({{ v: run(s) }}))));",
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
$fn = '\\FirstApp\\' . $schema['actions']['a']['handler'];
$out = [];
foreach (json_decode('{}') as $s) {{
    $input = new \First\JsObject();
    $input->p['s'] = $s;
    $out[] = json_decode(\First\Js::jsonStringify($fn($input, new \First\JsObject())));
}}
echo json_encode($out);
"#,
            serde_json::to_string(&inputs).unwrap()
        ),
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-tokens/first/app"),
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
            tmp.path().join("first.config.ts"),
            format!("import {{ action, defineConfig }} from 'first';\n{declarations}\nexport default defineConfig({{ name: 'rules', actions: {{ probe: action({{ input: {{}}, handler: () => {handler} }}) }} }});"),
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
        tmp.path().join("first/utils.mjs"),
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
            &format!("import match from './first/utils.mjs'; import * as utils from './first/utils.mjs'; process.stdout.write(JSON.stringify({expression}));"),
        ])
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        format!(
            r#"
import {{ action, defineConfig }} from 'first';
import match from './first/utils.mjs';
import * as utils from './first/utils.mjs';
export default defineConfig({{ name: 'namespaces', actions: {{ probe: action({{ input: {{}}, handler: () => {expression} }}) }} }});
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
$fn = '\\FirstApp\\' . $schema['actions']['probe']['handler'];
echo \First\Js::jsonStringify($fn(new \First\JsObject(), new \First\JsObject()));
"#,
        &[
            &content.join("plugins/first-runtime/first/bootstrap.php"),
            &content.join("plugins/first-app-namespaces/first/app"),
        ],
    );
    assert_eq!(actual, expected);
    // The namespace object and the function with properties are never built in PHP.
    let functions =
        std::fs::read_to_string(content.join("plugins/first-app-namespaces/first/app/functions.php")).unwrap();
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
        std::fs::write(tmp.path().join("first.config.ts"), format!("import {{action, defineConfig}} from 'first';\n{declarations}\nexport default defineConfig({{name:'namespaces',actions:{{probe:action({{input:{{}},handler:()=>{handler}}})}}}});")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{report}");
        let d = &report["diagnostics"][0];
        assert!(d["message"].as_str().unwrap().contains(message), "{message}: {report}");
        assert!(d["location"].is_object(), "{report}");
        assert!(d["help"].as_str().unwrap_or("").contains(help), "{help}: {report}");
    }
}

/// Authored TypeScript runs `for await` only over sync iterables of settled values (First's own
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
            tmp.path().join("first/h.mjs"),
            "export function untyped() { return [1, 2]; }\n",
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("first.config.ts"),
            format!("import {{ action, defineConfig }} from 'first';\nimport {{ untyped }} from './first/h.mjs';\nexport default defineConfig({{ name: 'awaits', actions: {{ probe: action({{ input: {{}}, handler: async () => {{ {source} }} }}) }} }});"),
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
/// source here hits one `First code doesn't support ...` refusal; the diagnostic must carry a
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
            "import * as ns from './first/ns.mjs';",
            "ns.nsThis()",
            "through the module namespace `ns`",
            "",
        ),
        (
            "function with properties in a this receiver",
            "import { withHelper } from './first/ns.mjs';",
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
            "",
            "{ return 1; } }), other: action({ input: {}, handler: function () { return typeof this; }",
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
            "const api = { n: 1, fact(k: number) { return k ? this.n * this.fact(k - 1) : 1; } };",
            "api.fact(2)",
            "has no field `fact`",
            "`fact` calls itself through `this`; annotate its return type, e.g. `fact(k: number): number`",
        ),
        (
            "module-level literal method reaching a sibling through a variable",
            "const api = { n: 1, first() { const self = this; return self.second(); }, second() { return this.n; } };",
            "api.first()",
            "has no field `second`",
            "through `this` held in a variable",
        ),
        (
            "receiver-typed callback",
            "",
            "[1].map(function (this: { x: number }, value) { return this.x + value; })",
            "so `this` is undefined, not { x: number }",
            "",
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
        write_app(tmp.path().join("first/ns.mjs"),
            "export function nsThis() { return typeof this; }\nfunction helper() { return 1; }\nhelper.x = 42;\nexport const withHelper = { helper, read() { return this.helper.x; } };\n",
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("first.config.ts"),
            format!("import {{ action, defineConfig }} from 'first';\n{declarations}\nexport default defineConfig({{ actions: {{ probe: action({{ input: {{}}, handler: () => {handler} }}) }} }});\n"),
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

/// `.was()` renames a stored column, so it is refused where there's none to rename, and a `was`
/// rename can't move a kind onto or off a table First didn't create (spec §2.5, §2.6, §2.9).
#[test]
fn was_renames_only_what_a_table_stores() {
    let tmp = tempfile::tempdir().unwrap();
    let build = |config: &str, previous: Option<Value>| -> Result<first::pipeline::Built, String> {
        std::fs::write(tmp.path().join("first.config.ts"), config).unwrap();
        let program = first::loader::load(&tmp.path().join("first.config.ts")).map_err(|d| d.message)?;
        first::pipeline::build(
            tmp.path(),
            &program,
            || first::pipeline::Previous::from_project(previous, []),
            |_| None,
        )
        .map_err(|d| d.message)
    };
    let refused = |config: &str| build(config, None).err().unwrap_or_default();
    let head = "import { defineConfig, collection, table, text, group } from 'first';";
    assert!(
        refused(&format!("{head} const posts = collection({{ title: text(), body: text().was('copy').optional() }}, {{ title: 'title' }}); export default defineConfig({{ collections: {{ posts }} }});"))
            .contains("`.was()` renames a column of a table()"),
    );
    assert!(
        refused(&format!("{head} const notes = table({{ meta: group({{ tag: text().was('label').optional() }}).optional() }}); export default defineConfig({{ tables: {{ notes }} }});"))
            .contains("`.was()` renames a stored column"),
    );
    // A First-created table renamed onto an adopted one (or back) would alter a table First didn't create.
    let first = build(
        &format!("{head} const notes = table({{}}); export default defineConfig({{ tables: {{ notes }} }});"),
        None,
    )
    .unwrap();
    let onto = build(
        &format!(
            "{head} const memos = table({{}}, {{ was: 'notes', existingTable: 'sf_space_memos' }}); export default defineConfig({{ tables: {{ memos }} }});"
        ),
        Some(first.snapshot.clone()),
    );
    assert!(
        onto.err()
            .unwrap_or_default()
            .contains("including through a `was` rename")
    );
    // The same rename between two First-created tables plans a RENAME, not a drop and a create.
    let renamed = build(
        &format!("{head} const memos = table({{}}, {{ was: 'notes' }}); export default defineConfig({{ tables: {{ memos }} }});"),
        Some(first.snapshot),
    )
    .unwrap();
    let sql = &renamed.migrations[0].1;
    assert!(
        sql.contains("RENAME TABLE `{prefix}first_notes` TO `{prefix}first_memos`;") && !sql.contains("DROP TABLE"),
        "{sql}"
    );
}

/// A Zero 0.8 table's name ends in a digest over the 0.8 table name, which the converter gives the
/// binding collection's key. The runtime checks it (`First\Wp\Guard`), so the key the binding was
/// first built under travels as `adoptedAs` in the snapshot, the adoption record and schema.php,
/// and survives a `was` rename of the collection.
#[test]
fn an_adopted_table_keeps_the_name_it_was_adopted_under_across_renames() {
    let tmp = tempfile::tempdir().unwrap();
    let build = |config: &str, previous: Option<Value>| -> first::pipeline::Built {
        std::fs::write(tmp.path().join("first.config.ts"), config).unwrap();
        let program = first::loader::load(&tmp.path().join("first.config.ts")).unwrap();
        first::pipeline::build(
            tmp.path(),
            &program,
            || first::pipeline::Previous::from_project(previous, ["0001_init.sql"]),
            |_| None,
        )
        .unwrap_or_else(|d| panic!("{}", d.message))
    };
    let head = "import { defineConfig, table, text } from 'first';";
    let legacy = "sf_spc_x_mytasks_a102734393";
    let adopted = build(
        &format!(
            "{head} const myTasks = table({{ title: text() }}, {{ existingTable: '{legacy}' }}); export default defineConfig({{ tables: {{ myTasks }} }});"
        ),
        None,
    );
    assert_eq!(adopted.snapshot["tables"]["my_tasks"]["adoptedAs"], "myTasks");
    let sql = &adopted.migrations[0].1;
    let record: Value = serde_json::from_str(
        sql.lines()
            .find_map(|l| l.strip_prefix("-- first-adopt "))
            .expect("an adoption record"),
    )
    .unwrap();
    assert_eq!((&record["table"], &record["name"]), (&json!(legacy), &json!("myTasks")));
    assert!(first::schema_php::render(&adopted.schema).contains("'adoptedAs' => 'myTasks',"));

    // Renamed with `was`: the table and the name it was adopted under stay.
    let renamed = build(
        &format!(
            "{head} const items = table({{ title: text() }}, {{ was: 'my_tasks', existingTable: '{legacy}' }}); export default defineConfig({{ tables: {{ items }} }});"
        ),
        Some(adopted.snapshot.clone()),
    );
    assert_eq!(renamed.snapshot["tables"]["items"]["adoptedAs"], "myTasks");
    assert!(first::schema_php::render(&renamed.schema).contains("'adoptedAs' => 'myTasks',"));
    // Renamed again, and on a snapshot from before `adoptedAs` (the stored name stands for it).
    let again = build(
        &format!(
            "{head} const things = table({{ title: text() }}, {{ was: 'items', existingTable: '{legacy}' }}); export default defineConfig({{ tables: {{ things }} }});"
        ),
        Some(renamed.snapshot.clone()),
    );
    assert_eq!(again.snapshot["tables"]["things"]["adoptedAs"], "myTasks");
    let mut old = adopted.snapshot.clone();
    old["tables"]["my_tasks"].as_object_mut().unwrap().remove("adoptedAs");
    let from_old = build(
        &format!(
            "{head} const items = table({{ title: text() }}, {{ was: 'my_tasks', existingTable: '{legacy}' }}); export default defineConfig({{ tables: {{ items }} }});"
        ),
        Some(old),
    );
    assert_eq!(from_old.snapshot["tables"]["items"]["adoptedAs"], "my_tasks");

    // A key that is its own stored name writes nothing new: earlier snapshots stay as they are.
    let plain = build(
        &format!(
            "{head} const tasks = table({{ title: text() }}, {{ existingTable: 'sf_spc_x_tasks_0123456789' }}); export default defineConfig({{ tables: {{ tasks }} }});"
        ),
        None,
    );
    assert!(plain.snapshot["tables"]["tasks"].get("adoptedAs").is_none());
    assert!(!first::schema_php::render(&plain.schema).contains("adoptedAs"));
    // A table stored before `adoptedAs` keeps its stored name, even under a new key: the key may be
    // a later alias (`storageName` keeps the storage), not the name the 0.8 table was made from.
    let mut old = plain.snapshot.clone();
    old["tables"]["tasks"].as_object_mut().unwrap().remove("adoptedAs");
    let aliased = build(
        &format!(
            "{head} const chores = table({{ title: text() }}, {{ storageName: 'tasks', existingTable: 'sf_spc_x_tasks_0123456789' }}); export default defineConfig({{ tables: {{ chores }} }});"
        ),
        Some(old),
    );
    assert!(
        aliased.snapshot["tables"]["tasks"].get("adoptedAs").is_none(),
        "{:#}",
        aliased.snapshot
    );
}

/// The OpenAPI document and the Abilities describe one value one way. `src/json_schema.rs` is the
/// compiler's copy of `Wp\Abilities\JsonSchema`, and this runs both: for every kind, global and
/// action of an app, the schema in `first/_generated/openapi.json` is the one the registered
/// Ability publishes (a row is the `-get` output, a create input the `-create` input, a patch the
/// `-update` input's `patch`). The apps cover every field type, a users kind, localized kinds and
/// relations.
#[test]
fn openapi_schemas_are_the_registered_ability_schemas() {
    for source in ["tests/fixtures/openapi", "examples/blog"] {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("app");
        copy_dir(&root().join(source), &project);
        let _ = std::fs::remove_dir_all(project.join(".first"));
        let content = build_wp(&project);
        let program = first::loader::load(&project.join("first.config.ts")).unwrap();
        let built =
            first::pipeline::build(&project, &program, || Ok(first::pipeline::Previous::none()), |_| None).unwrap();
        let out = Command::new("php")
            .args(["-d", "memory_limit=512M"])
            .arg(root().join("tests/php/wp.php"))
            .arg("eval")
            .arg(&content)
            .arg(
                r#"
                $out = [];
                foreach (\First\Wp\Abilities\Register::operations() as $op) {
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
        let app = first::wordpress::abilities::kebab(&schema.name);
        let kebab = first::wordpress::abilities::kebab;
        let mut compared = 0;
        for c in schema.collections.values() {
            let k = kebab(&c.table);
            let name = first::client::type_name(&c.key);
            if c.api.get {
                assert_eq!(
                    first::json_schema::row(c),
                    registered[format!("{app}/{k}-get")]["output"],
                    "{source}: the row of {}",
                    c.table
                );
                // The document's row is that schema; it only adds notes and the `with` relations.
                for (field, published) in first::json_schema::row(c)["properties"].as_object().unwrap() {
                    let mut documented = components[&name]["properties"][field].clone();
                    if c.relations.contains_key(field) {
                        documented = documented["anyOf"][0].clone();
                    }
                    let documented = documented.as_object_mut().unwrap();
                    documented.remove("description");
                    documented.remove("x-first-access");
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
                assert_eq!(
                    components[format!("{name}Patch")],
                    registered[format!("{app}/{k}-update")]["input"]["properties"]["patch"],
                    "{source}: {name}Patch"
                );
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
