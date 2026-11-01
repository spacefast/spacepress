//! Executable joins between compatibility claims, diagnostics, authoring and PHP behavior.
use serde_json::{Value, json};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn zero() -> Command {
    Command::new(env!("CARGO_BIN_EXE_zero"))
}

fn checked(project: &Path) -> (Output, Value) {
    let out = zero().args(["check", "--json"]).arg(project).output().unwrap();
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
    let output = project.join(".zero/wp-content");
    let out = zero().args(["build", "--target", "wp"]).arg(project).output().unwrap();
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
    let source = "import './a';\nimport './b';\n/*😀*/ class First {}\nclass Second {}\nconst clock = Date.now();\n";
    std::fs::write(tmp.path().join("zero.config.ts"), source).unwrap();
    for name in ["a.ts", "b.ts"] {
        std::fs::write(tmp.path().join(name), "class Imported {}\n").unwrap();
    }
    let (out, report) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(report["schema"], "zero-diagnostics");
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
            .all(|d| d["code"] == "Z1101")
    );
    let loc = &report["diagnostics"][0]["location"];
    assert_eq!(loc["file"], "zero.config.ts");
    assert_eq!(loc["start"], source.find("class First").unwrap());
    assert_eq!(loc["column"], "/*😀*/ ".encode_utf16().count() + 1);
    assert_eq!(loc["line"], 3);
    assert_eq!(report, checked(tmp.path()).1, "diagnostics must be deterministic");
    assert!(!tmp.path().join("zero").exists());
    assert!(!tmp.path().join(".zero").exists());
    // A partially lowered program must never run the Date.now() declaration.
    assert!(!report.to_string().contains("Z2101"));
    let human = zero().arg("check").arg(tmp.path()).output().unwrap();
    assert_eq!(human.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&human.stderr).contains("Zero code doesn't support classes"));
}

#[test]
fn successful_json_check_and_the_reusable_recipe_write_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    for file in ["zero.config.ts", "seo.ts"] {
        std::fs::copy(root().join("examples/recipes").join(file), tmp.path().join(file)).unwrap();
    }
    let (out, report) = checked(tmp.path());
    assert!(out.status.success(), "{report}");
    assert_eq!(report["ok"], true);
    assert_eq!(report["diagnostics"], json!([]));
    assert_eq!(report["groups"], json!([]));
    assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 2);
}

#[test]
fn nested_presentation_reaches_scf_and_public_schema_without_storage_migrations() {
    let tmp = tempfile::tempdir().unwrap();
    let config = r#"import { collection, defineConfig, id, text, group, repeater, blocks, json } from "zero";
const notes = collection("notes", {
  id: id(), title: text().notNull(),
  seo: group({ fields: { summary: text().ui({ label: "Display name", help: "<b>Plain text</b>", placeholder: "Jane", width: 50 }) } }).ui({ label: "SEO" }),
  rows: repeater({ fields: { value: text().ui({ label: "Row value" }) } }),
  content: blocks({ layouts: { hero: { heading: text().ui({ label: "Heading" }) } } }),
  metadata: json(),
}, { title: "title" });
export default defineConfig({ name: "presentation", schema: { notes } });"#;
    std::fs::write(tmp.path().join("zero.config.ts"), config).unwrap();
    let content = build_wp(tmp.path());
    let schema = content.join("plugins/zero-app-presentation/zero/app/schema.php");
    let got = php(
        r#"
        require $argv[1];
        $schema = \Zero\Schema::load($argv[2]);
        $columns = $schema->collection('notes')['columns'];
        $field = \Zero\Wp\Scf::fieldFor($schema, 'field_seo', 'zero_seo', 'seo', $columns['seo'], []);
        $json = \Zero\Wp\Scf::fieldFor($schema, 'field_metadata', 'zero_metadata', 'metadata', $columns['metadata'], []);
        echo json_encode(['columns' => $columns, 'public' => $schema->describe()['collections']['notes']['columns'], 'field' => $field, 'json' => $json]);
    "#,
        &[&content.join("plugins/zero-runtime/zero/bootstrap.php"), &schema],
    );
    let ui = json!({"label": "Display name", "help": "<b>Plain text</b>", "placeholder": "Jane", "width": 50});
    assert_eq!(got["columns"]["seo"]["fields"]["summary"]["ui"], ui);
    assert_eq!(got["public"]["seo"]["fields"]["summary"]["ui"], ui);
    assert_eq!(got["public"]["rows"]["fields"]["value"]["ui"]["label"], "Row value");
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
    let snapshot = tmp.path().join("zero/migrations/snapshot.json");
    let before = std::fs::read(&snapshot).unwrap();
    std::fs::write(
        tmp.path().join("zero.config.ts"),
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
        std::fs::read_dir(tmp.path().join("zero/migrations/sqlite"))
            .unwrap()
            .count(),
        1
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
        std::fs::write(tmp.path().join("zero.config.ts"), format!(
            "import {{ collection, id, text, defineConfig }} from 'zero'; const notes = collection('notes', {{ id: id(), title: text().ui({ui}) }}, {{ title: 'title' }}); export default defineConfig({{ schema: {{ notes }} }});"
        )).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{ui}: {report}");
        assert_eq!(report["diagnostics"][0]["code"], "Z3101", "{ui}: {report}");
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
    std::fs::write(tmp.path().join("zero.config.ts"), format!(r#"
import {{ collection, id, text, json, action, defineConfig }} from "zero";
const values = {values};
const encoded = values.map(value => [encodeURI(value), encodeURIComponent(value)]);
const notes = collection("notes", {{ id: id(), title: text().notNull(), result: json().default(encoded) }}, {{ title: "title" }});
export default defineConfig({{ name: "uri", schema: {{ notes }}, actions: {{ encode: action({{ input: {{}}, handler: () => values.map(value => [encodeURI(value), encodeURIComponent(value)]) }}) }} }});
"#)).unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/zero-app-uri/zero/app");
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\ZeroApp\\' . $schema['actions']['encode']['handler'];
        echo json_encode([$schema['collections']['notes']['columns']['result']['default']['value'], $fn([], ['user' => null, 'target' => 'wp'])]);
    "#,
        &[&content.join("plugins/zero-runtime/zero/bootstrap.php"), &app],
    );
    assert_eq!(result, json!([expected, expected]));
    let invalid = php(
        r#"
        require $argv[1];
        try { \Zero\Js::encodeURI("\xC0\xAF"); echo json_encode('accepted'); }
        catch (\Zero\JsError $e) { echo json_encode($e->jsName); }
    "#,
        &[&root().join("runtime/Zero/bootstrap.php")],
    );
    assert_eq!(invalid, "URIError");
}

#[test]
fn syntax_and_environment_failures_also_produce_a_complete_json_envelope() {
    let tmp = tempfile::tempdir().unwrap();
    let (out, missing) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(missing["diagnostics"][0]["code"], "Z1003");
    assert_eq!(missing["diagnostics"][0]["location"], Value::Null);
    std::fs::write(tmp.path().join("zero.config.ts"), "const x = ;").unwrap();
    let (out, syntax) = checked(tmp.path());
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(syntax["diagnostics"][0]["code"], "Z1001");
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
            std::fs::write(tmp.path().join("zero.config.ts"), format!(r#"
import {{ collection, id, text, action, defineConfig }} from "zero";
const result = {invocation};
const notes = collection("notes", {{ id: id(), title: text().notNull() }}, {{ title: "title" }});
export default defineConfig({{ schema: {{ notes }}, actions: {{ encode: action({{ input: {{}}, handler: {handler_body} }}) }} }});
"#, handler_body = if handler { "result".to_string() } else { "() => result".to_string() })).unwrap();
            let (out, report) = checked(tmp.path());
            assert_eq!(out.status.code(), Some(1), "{expression}: {report}");
            assert_eq!(report["ok"], false);
            assert!(!tmp.path().join(".zero").exists());
        }
    }
}

#[test]
fn documented_runtime_differences_are_measured_in_evaluation_and_compiled_php() {
    let expression = r#"[typeof undefined, typeof null, "🙂a".slice(2), "🙂".length]"#;
    let node = Command::new("node")
        .args(["-e", &format!("process.stdout.write(JSON.stringify({expression}));")])
        .output()
        .unwrap();
    assert!(node.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&node.stdout).unwrap(),
        json!(["undefined", "object", "a", 2])
    );
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("zero.config.ts"), format!(r#"
import {{ collection, id, text, json, action, defineConfig }} from "zero";
const notes = collection("notes", {{ id: id(), title: text().notNull(), result: json().default({expression}) }}, {{ title: "title" }});
export default defineConfig({{ name: "differences", schema: {{ notes }}, actions: {{ measure: action({{ input: {{}}, handler: () => {expression} }}) }} }});
"#)).unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\ZeroApp\\' . $schema['actions']['measure']['handler'];
        echo json_encode([$schema['collections']['notes']['columns']['result']['default']['value'], $fn([], ['user' => null, 'target' => 'wp'])]);
    "#,
        &[
            &content.join("plugins/zero-runtime/zero/bootstrap.php"),
            &content.join("plugins/zero-app-differences/zero/app"),
        ],
    );
    assert_eq!(
        result,
        json!([["undefined", "object", "", 2], ["object", "object", "", 2]])
    );
}
