//! Executable joins between compatibility claims, diagnostics, authoring and PHP behavior.

// Runs the `zero` binary: only with the cli feature (the browser build of the core has none).
#![cfg(feature = "cli")]
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
    let out = zero().arg("build").arg(project).output().unwrap();
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
    std::fs::write(tmp.path().join("zero.config.ts"), source).unwrap();
    for name in ["a.ts", "b.ts"] {
        std::fs::write(tmp.path().join(name), "abstract class Imported {}\n").unwrap();
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
    assert_eq!(loc["start"], source.find("abstract class First").unwrap());
    assert_eq!(loc["column"], "/*😀*/ ".encode_utf16().count() + 1);
    assert_eq!(loc["line"], 3);
    assert_eq!(report, checked(tmp.path()).1, "diagnostics must be deterministic");
    assert!(!tmp.path().join("zero").exists());
    assert!(!tmp.path().join(".zero").exists());
    // A partially lowered program must never run the Date.now() declaration.
    assert!(!report.to_string().contains("Z2101"));
    let human = zero().arg("check").arg(tmp.path()).output().unwrap();
    assert_eq!(human.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&human.stderr).contains("abstract, ambient or generic classes"));
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
const notes = collection({
  id: id(), title: text().notNull(),
  seo: group({ fields: { summary: text().ui({ label: "Display name", help: "<b>Plain text</b>", placeholder: "Jane", width: 50 }) } }).ui({ label: "SEO" }),
  rows: repeater({ fields: { value: text().ui({ label: "Row value", help: undefined, placeholder: undefined, width: undefined }) } }),
  content: blocks({ layouts: { hero: { heading: text().ui({ label: "Heading" }) } } }),
  metadata: json(),
}, { title: "title" });
export default defineConfig({ name: "presentation", collections: { notes } });"#;
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
        std::fs::read_dir(tmp.path().join("zero/migrations"))
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
        std::fs::write(tmp.path().join("zero.config.ts"), format!(
            "import {{ collection, id, text, defineConfig }} from 'zero'; const notes = collection({{ id: id(), title: text().ui({ui}) }}, {{ title: 'title' }}); export default defineConfig({{ collections: {{ notes }} }});"
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
const notes = collection({{ id: id(), title: text().notNull(), result: json().default(encoded) }}, {{ title: "title" }});
export default defineConfig({{ name: "uri", collections: {{ notes }}, actions: {{ encode: action({{ input: {{}}, handler: () => values.map(value => [encodeURI(value), encodeURIComponent(value)]) }}) }} }});
"#)).unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/zero-app-uri/zero/app");
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\ZeroApp\\' . $schema['actions']['encode']['handler'];
        echo \Zero\Js::jsonStringify([\Zero\Js::decodeJson($schema['collections']['notes']['columns']['result']['default']['json']), $fn(new \Zero\JsObject(), \Zero\Seam::ctx(['user' => null]))]);
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
const notes = collection({{ id: id(), title: text().notNull() }}, {{ title: "title" }});
export default defineConfig({{ collections: {{ notes }}, actions: {{ encode: action({{ input: {{}}, handler: {handler_body} }}) }} }});
"#, handler_body = if handler { "result".to_string() } else { "() => result".to_string() })).unwrap();
            let (out, report) = checked(tmp.path());
            assert_eq!(out.status.code(), Some(1), "{expression}: {report}");
            assert_eq!(report["ok"], false);
            assert!(!tmp.path().join(".zero").exists());
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
            tmp.path().join("zero.config.ts"),
            format!(
                r#"
import {{ action, defineConfig }} from "zero";
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
    std::fs::write(tmp.path().join("helpers.mjs"), helper).unwrap();
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
  const object: { count: number } | null = undefined;
  const array: string[] | null = undefined;
  const text: string | null = undefined;
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
        .args(["--input-type=module-typescript", "-e", &format!("import {{combine, read, absent, objects, replaceCount, replaceCopiedSlot, methodOrder, missingKinds, errorEffects}} from './helpers.mjs'; {mutation} process.stdout.write(JSON.stringify({expression}));")])
        .output().unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    std::fs::write(tmp.path().join("zero.config.ts"), format!(r#"
import {{ action, defineConfig }} from 'zero';
import {{ combine, read, absent, objects, replaceCount, replaceCopiedSlot, methodOrder, missingKinds, errorEffects }} from './helpers.mjs';
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
  $fn = '\\ZeroApp\\' . $schema['actions'][$key]['handler'];
  $result[] = $fn(new \Zero\JsObject(), new \Zero\JsObject());
}
echo \Zero\Js::jsonStringify($result);
"#,
        &[
            &content.join("plugins/zero-runtime/zero/bootstrap.php"),
            &content.join("plugins/zero-app-js-values/zero/app"),
        ],
    );
    assert_eq!(actual, json!([expected, true, true]));

    // The nonempty proof belongs to the container and must disappear through aliases.
    std::fs::write(
        tmp.path().join("zero.config.ts"),
        r#"
import { action, defineConfig } from 'zero';
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
    std::fs::write(
        tmp.path().join("helpers.mjs"),
        "export function change(values) { const push = [].push; push.call(values, 'x'); }",
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("zero.config.ts"),
        r#"
import { action, defineConfig } from 'zero';
import { change } from './helpers.mjs';
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
        std::fs::write(
            tmp.path().join("helpers.mjs"),
            format!("function mutate({parameters}) {{ const method = 'apply'; const copied = {copied}; copied{field} = 'x'; }} export function change(values) {{ mutate({argument}); }}"),
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("zero.config.ts"),
            r#"
import { action, defineConfig } from 'zero';
import { change } from './helpers.mjs';
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

#[test]
fn documented_runtime_differences_are_measured_in_evaluation_and_compiled_php() {
    let expression = r#"[typeof undefined, typeof null, "🙂a".slice(2), "🙂".length, "🙂a"[2], "x🙂".split("", 1), [1, 2].includes(1, 1), [1, 2, 1].indexOf(1, -1), typeof [][0]]"#;
    let node = Command::new("node")
        .args(["-e", &format!("process.stdout.write(JSON.stringify({expression}));")])
        .output()
        .unwrap();
    assert!(node.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&node.stdout).unwrap(),
        json!(["undefined", "object", "a", 2, "a", ["x"], false, 2, "undefined"])
    );
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("zero.config.ts"), format!(r#"
import {{ collection, id, text, json, action, defineConfig }} from "zero";
const measured = {expression};
const notes = collection({{ id: id(), title: text().notNull(), result: json().default(measured) }}, {{ title: "title" }});
export default defineConfig({{ name: "differences", collections: {{ notes }}, actions: {{ measure: action({{ input: {{}}, handler: () => {expression} }}) }} }});
"#)).unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $fn = '\\ZeroApp\\' . $schema['actions']['measure']['handler'];
        echo \Zero\Js::jsonStringify([\Zero\Js::decodeJson($schema['collections']['notes']['columns']['result']['default']['json']), $fn(new \Zero\JsObject(), \Zero\Seam::ctx(['user' => null]))]);
    "#,
        &[
            &content.join("plugins/zero-runtime/zero/bootstrap.php"),
            &content.join("plugins/zero-app-differences/zero/app"),
        ],
    );
    assert_eq!(
        result,
        json!([
            ["undefined", "object", "a", 2, "a", ["x"], false, 2, "undefined"],
            ["undefined", "object", "a", 2, "a", ["x"], false, 2, "undefined"]
        ])
    );
    std::fs::write(tmp.path().join("zero.config.ts"), r#"const half = "🙂a".slice(1);"#).unwrap();
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
fn classes_match_node_through_generated_php_and_wire_client_types() {
    let tmp = tempfile::tempdir().unwrap();
    let config = root().join("tests/differential/classes.ts");
    std::fs::copy(&config, tmp.path().join("zero.config.ts")).unwrap();
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
    let runtime = content.join("plugins/zero-runtime/zero/bootstrap.php");
    let app = content.join("plugins/zero-app-class-tests/zero/app");
    let actual = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $out = [];
        foreach ($schema['actions'] as $name => $action) {
            $fn = '\\ZeroApp\\' . $action['handler'];
            try { $out[$name] = ['data' => $fn()]; }
            catch (\Throwable $e) { $out[$name] = ['error' => $e->getMessage()]; }
        }
        echo \Zero\Js::jsonStringify($out);
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
        $fn = '\\ZeroApp\\' . $schema['actions']['classesWire']['handler'];
        $instance = $fn();
        $stored = \Zero\Seam::toPhp($instance, ['type' => 'json']);
        $input = \Zero\Seam::toJs($stored, ['type' => 'json']);
        $stored->p['count'] = 99;
        echo \Zero\Js::jsonStringify([
            'wire' => \Zero\Seam::toWire($instance),
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
import type { Actions } from './zero/client/types';
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
fn class_boundaries_refuse_unsupported_semantics_at_the_source() {
    for (declarations, handler, message) in [
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
            "`this` outside a class",
        ),
        ("class C { #secret = 1; }", "new C()", "private class fields"),
        (
            "class C { constructor(public toJSON: () => number) {} }",
            "new C(() => 1)",
            "protocol class members",
        ),
        (
            "class C { get value() { return 1; } }",
            "new C()",
            "accessor class methods",
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
            "{ value: json().$type<C>() }"
        } else {
            "{}"
        };
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{ table, id, json, action, defineConfig }} from 'zero';\n{declarations}\nexport default defineConfig({{ tables: {{ n: table({{ id: id() }}) }}, actions: {{ test: action({{input: {input}, handler: () => {handler} }}) }} }});\n")).unwrap();
        let (out, report) = checked(tmp.path());
        assert_eq!(out.status.code(), Some(1), "{message}: {report}");
        let diagnostic = report["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["message"].as_str().unwrap().contains(message))
            .unwrap_or_else(|| panic!("expected {message}: {report}"));
        assert_eq!(diagnostic["location"]["file"], "zero.config.ts", "{report}");
        assert!(diagnostic["location"]["line"].as_u64().unwrap() >= 2);
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
    std::fs::write(tmp.path().join("helper.js"), javascript).unwrap();
    let entry = tmp.path().join("zero.config.ts");
    std::fs::write(&entry, format!("import {{ action, defineConfig }} from 'zero';\n{declarations}\nexport default defineConfig({{name: 'builtinparity', actions: {{{}}}}});", actions.join(",\n"))).unwrap();
    let node = Command::new("node")
        .arg(root().join("tests/differential/run-node.mjs"))
        .arg(&entry)
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/zero-app-builtinparity/zero/app");
    let actual = php(
        r#"
        require $argv[1];
        $schema = require $argv[2] . '/schema.php';
        require $argv[2] . '/functions.php';
        $out = new \Zero\JsObject();
        foreach ($schema['actions'] as $name => $action) {
            $fn = '\ZeroApp\\' . $action['handler'];
            $out->p[$name] = new \Zero\JsObject(['data' => $fn(new \Zero\JsObject(), \Zero\Seam::ctx(['user' => null]))]);
        }
        echo \Zero\Js::jsonStringify($out);
    "#,
        &[&content.join("plugins/zero-runtime/zero/bootstrap.php"), &app],
    );
    assert_eq!(actual, expected["cases"]);
}

#[test]
fn unsupported_builtin_overloads_are_located_in_both_phases() {
    for expression in [
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
        "'aba'.replace(/(a(b)?)+/, '[$2]')",
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
            std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{action, defineConfig}} from 'zero';\n{declaration}\nexport default defineConfig({{name:'refusal',actions:{{probe:action({{input:{{}},handler:()=>{result}}})}}}});")).unwrap();
            let (out, report) = checked(tmp.path());
            assert_eq!(out.status.code(), Some(1), "{expression}, handler={handler}: {report}");
            let diagnostic = &report["diagnostics"][0];
            assert!(diagnostic["location"].is_object(), "{expression}: {report}");
            assert!(diagnostic["help"].is_string(), "{expression}: {report}");
        }
    }
}

#[test]
fn unsupported_features_have_positions_and_actionable_help() {
    for (source, message) in [
        (
            "const helper = (value: any) => value; return helper('x');",
            "`any` isn't allowed",
        ),
        ("outer: for (const n of [1]) { break outer; } return true;", "labels"),
        ("return fetch('https://example.com');", "fetch"),
        ("return new Map<string, number>();", "new Map"),
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
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{action, defineConfig}} from 'zero';\nexport default defineConfig({{name:'diagnostics',actions:{{probe:action({{input:{{}},handler:()=>{{ {source} }} }})}}}});")).unwrap();
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
        "String(''.trim)",
        "[''.trim].join(',')",
        "'abc'.includes(''.trim)",
        "'abc'.slice({valueOf: () => 1})",
        "'a,b,c'.split(',', {valueOf: () => 2})",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{action, defineConfig}} from 'zero';\nconst result = {expression};\nexport default defineConfig({{name:'coercion',actions:{{probe:action({{input:{{}},handler:()=>result}})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{action, defineConfig, table, id, db}} from 'zero';\nconst notes = table({{id:id()}});\nexport default defineConfig({{name:'queryarity',tables:{{notes}},actions:{{probe:action({{input:{{}},handler:async()=>{{let n=0; await db.query.notes.{method}({{}}, n++); return n;}}}})}}}});")).unwrap();
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
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{action, defineConfig, table, id, integer, db}} from 'zero';\nconst notes=table({{id:id(),count:integer()}});\nexport default defineConfig({{name:'builderarity',tables:{{notes}},actions:{{probe:action({{input:{{}},handler:async()=>{{let n=0; await {expression}; return n;}}}})}}}});")).unwrap();
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
            \Zero\Js::parseInt('120101100002111211120012010111012200200201', 3);
            echo json_encode(['accepted']);
        } catch (\Zero\JsError $error) {
            echo json_encode([$error->jsName, $error->getMessage()]);
        }
    "#,
        &[&root().join("runtime/Zero/bootstrap.php")],
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
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{action, defineConfig}} from 'zero';\nconst value = (() => {{try {{ {expression}; return 0; }} catch (e) {{ return 1; }} }})();\nexport default defineConfig({{actions:{{probe:action({{input:{{}},handler:()=>value}})}}}});" )).unwrap();
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
        "id(1)",
        "text().notNull(false)",
        "text().default('x', 1)",
        "json().$type<string>(1)",
        "defineConfig({}, 1)",
        "action({handler:()=>1}, 1)",
        "new HttpError(400, 'bad', 'message')",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{text, id, json, action, defineConfig, HttpError}} from 'zero';\nconst invalid = {expression};\nexport default defineConfig({{actions:{{probe:action({{handler:()=>1}})}}}});")).unwrap();
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
        "const holder={method:' abc '.trim}; const result=holder.method();",
        "const holder={'method':' abc '.trim}; const result=holder['method']();",
        "const methods=[' abc '.trim]; const result=methods[0]();",
        "const methods=[' abc '.trim]; const result=methods['0']();",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{action,defineConfig}} from 'zero';\n{source}\nexport default defineConfig({{actions:{{probe:action({{handler:()=>result}})}}}});")).unwrap();
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
    for (expression, folded) in [("{__proto__: null}", true), ("{'__proto__': null}", false)] {
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
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{action,defineConfig}} from 'zero';\n{declaration}\nexport default defineConfig({{actions:{{probe:action({{handler:()=>{body}}})}}}});")).unwrap();
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
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{action,defineConfig}} from 'zero';\nconst folded={expression};\nexport default defineConfig({{actions:{{probe:action({{handler:()=>folded}})}}}});")).unwrap();
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
    let entry = tmp.path().join("zero.config.ts");
    std::fs::write(&entry, "import {action,defineConfig} from 'zero'; export default defineConfig({name:'logresult',actions:{probe:action({input:{},handler:()=>{const result=console.warn('builtin-return-marker');return [typeof result,result===undefined,result===null];}})}});").unwrap();
    let node = Command::new("node")
        .arg(root().join("tests/differential/run-node.mjs"))
        .arg(&entry)
        .output()
        .unwrap();
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    assert!(String::from_utf8_lossy(&node.stderr).contains("builtin-return-marker"));
    let expected: Value = serde_json::from_slice(&node.stdout).unwrap();
    let content = build_wp(tmp.path());
    let app = content.join("plugins/zero-app-logresult/zero/app");
    let actual = Command::new("php").args(["-r", r#"require $argv[1]; $schema=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\ZeroApp\\'.$schema['actions']['probe']['handler'];echo \Zero\Js::jsonStringify($fn());"#]).arg(content.join("plugins/zero-runtime/zero/bootstrap.php")).arg(app).output().unwrap();
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
    std::fs::write(tmp.path().join("zero.config.ts"), "import {action,defineConfig} from 'zero'; const power=(base:number,exponent:number)=>Math.pow(base,exponent); const log=(value:number)=>Math.log(value); const exp=(value:number)=>Math.exp(value); export default defineConfig({name:'powerrefusal',actions:{probe:action({handler:()=>{const out:string[]=[];try{power(3,35);}catch{out.push('power');}try{power(45.29,-1);}catch{out.push('reciprocal');}try{log(3);}catch{out.push('log');}try{exp(1);}catch{out.push('exp');}return out;}})}});").unwrap();
    let content = build_wp(tmp.path());
    let result = php(
        r#"require $argv[1];$schema=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$fn='\ZeroApp\\'.$schema['actions']['probe']['handler'];echo \Zero\Js::jsonStringify($fn());"#,
        &[
            &content.join("plugins/zero-runtime/zero/bootstrap.php"),
            &content.join("plugins/zero-app-powerrefusal/zero/app"),
        ],
    );
    assert_eq!(result, json!(["power", "reciprocal", "log", "exp"]));
}

#[test]
fn configuration_refuses_unmodeled_inherited_properties() {
    for expression in [
        "typeof ({}).toString",
        "typeof ({}).constructor",
        "typeof ({}).hasOwnProperty",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{action,defineConfig}} from 'zero';\nconst folded={expression};\nexport default defineConfig({{actions:{{probe:action({{handler:()=>folded}})}}}});")).unwrap();
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
    ] {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("zero.config.ts"), format!("import {{json,action,defineConfig}} from 'zero';\nexport default defineConfig({{actions:{{probe:action({{input:{{values:json().$type<{annotation}>().notNull()}},handler:(input)=>input.values}})}}}});")).unwrap();
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
