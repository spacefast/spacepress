//! Config importer owner: run the CLI, compile the result, load emitted PHP metadata.

// Runs the `zero` binary: only with the cli feature (the browser build of the core has none).
#![cfg(feature = "cli")]
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn zero() -> Command {
    Command::new(env!("CARGO_BIN_EXE_zero"))
}
fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/config-migrate")
        .join(name)
}
fn migrate(from: &str, input: &Path, out: &Path) -> Output {
    zero()
        .args(["migrate", "config", "--from", from])
        .arg(input)
        .arg("--out")
        .arg(out)
        .output()
        .unwrap()
}
fn schema(path: &Path) -> Value {
    let out = Command::new("php")
        .args(["-r", "echo json_encode(require $argv[1]);"])
        .arg(path)
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
}

/// Migrate a fixture into a fresh directory; returns (dir, report).
fn migrate_fixture(from: &str, file: &str) -> (tempfile::TempDir, Value) {
    let dir = tempfile::tempdir().unwrap();
    let out = migrate(from, &fixture(file), &dir.path().join("zero.config.ts"));
    assert!(
        out.status.success(),
        "{from}: {}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    (dir, serde_json::from_slice(&out.stdout).unwrap())
}

fn build_fixture(dir: &Path) -> PathBuf {
    let out = dir.join("wp-content");
    let build = zero().args(["build", "--out"]).arg(&out).arg(dir).output().unwrap();
    assert!(build.status.success(), "{}", String::from_utf8_lossy(&build.stderr));
    out
}

#[test]
fn each_source_compiles_with_its_storage_and_access() {
    for (from, file, plugin, public) in [
        ("emdash", "emdash.json", "zero-app-imported", false),
        ("payload", "payload.ts", "zero-app-imported", true),
        ("sanity", "sanity.ts", "zero-app-imported", false),
        ("zero", "legacy-zero.ts", "zero-app-notes", true),
    ] {
        let (dir, report) = migrate_fixture(from, file);
        assert_eq!(report["status"], "written");
        assert!(
            report["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["outcome"] == "review")
        );
        {
            let data = schema(&build_fixture(dir.path()).join(format!("plugins/{plugin}/zero/app/schema.php")));
            let notes = &data["collections"]["notes"];
            assert_eq!(notes["editor"], true, "{from}");
            assert_eq!(notes["columns"]["title"]["notNull"], true);
            assert_eq!(notes["access"]["read"]["allow"], json!(public), "{from}");
            assert_eq!(notes["access"]["create"]["allow"], false);
        }
    }
}

#[test]
fn publication_never_overwrites_the_source_or_an_existing_config() {
    let input = fixture("payload.ts");
    let original = std::fs::read(&input).unwrap();
    let (dir, _) = migrate_fixture("payload", "payload.ts");
    let config = dir.path().join("zero.config.ts");
    let before = std::fs::read(&config).unwrap();
    let collision = migrate("payload", &input, &config);
    assert_eq!(collision.status.code(), Some(1));
    assert_eq!(std::fs::read(&config).unwrap(), before);
    assert_eq!(std::fs::read(&input).unwrap(), original);
}

#[test]
fn required_emdash_and_sanity_strings_reject_empty_values() {
    for (from, file, fields) in [
        ("emdash", "emdash.json", vec!["title", "description"]),
        ("sanity", "sanity.ts", vec!["title"]),
    ] {
        let (dir, _) = migrate_fixture(from, file);
        let app = build_fixture(dir.path());
        let base: serde_json::Map<String, Value> = fields.iter().map(|f| (f.to_string(), json!("Value"))).collect();
        let cases = json!(fields.iter().map(|f| json!([f, ""])).collect::<Vec<_>>());
        let expected = json!(fields.iter().map(|f| json!(format!("/{f}"))).collect::<Vec<_>>());
        assert_eq!(accepts(&app, Value::Object(base), cases), expected, "{from}");
    }
}

#[test]
fn payload_optional_email_is_reported_for_empty_strings() {
    let (_dir, report) = migrate_fixture("payload", "payload.ts");
    assert!(
        report["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["pointer"] == "/collections/0/fields/4"
                && e["outcome"] == "review"
                && e["reason"].as_str().unwrap().contains("empty strings"))
    );
}

/// The Payload fixture built for WordPress, plus a valid row's base values.
fn payload_app() -> (tempfile::TempDir, PathBuf, Value) {
    let (dir, _) = migrate_fixture("payload", "payload.ts");
    let app = build_fixture(dir.path());
    (dir, app, json!({"title": "Title", "body": "Body", "tags": ["one"]}))
}

/// Run PHP on a fresh WordPress-on-SQLite site with the built plugins active (`$app` is the booted
/// Zero\App, `$arg` the decoded argument); returns its JSON output. See tests/php/wp.php `eval`.
fn run_php(app: &Path, body: &str, arg: &Value) -> Value {
    let out = wp_eval(app, body, arg);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    let json = text.lines().rfind(|l| !l.contains("wp_is_block_theme")).unwrap_or("");
    serde_json::from_str(json).unwrap_or_else(|_| panic!("{text}"))
}

fn wp_eval(app: &Path, body: &str, arg: &Value) -> Output {
    Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/wp.php"))
        .arg("eval")
        .arg(app)
        .arg(body)
        .arg(arg.to_string())
        .output()
        .unwrap()
}

/// The row the Payload app stores for the minimal valid input.
fn payload_default_row() -> Value {
    let (_dir, app, base) = payload_app();
    run_php(
        &app,
        "echo \\Zero\\Js::jsonStringify($app->db->insert('notes', $arg, true)[0]);",
        &base,
    )
}

#[test]
fn payload_declared_defaults_survive_the_import() {
    let row = payload_default_row();
    assert_eq!(
        [&row["priority"], &row["stage"], &row["details"]],
        [&json!(2), &json!("todo"), &json!([])]
    );
}

#[test]
fn payload_required_checkboxes_default_to_false() {
    assert_eq!(payload_default_row()["done"], false);
}

#[test]
fn payload_optional_checkboxes_stay_absent() {
    assert_eq!(payload_default_row()["archived"], Value::Null);
}

#[test]
fn payload_updated_at_moves_on_update() {
    let (_dir, app, base) = payload_app();
    let rows = run_php(
        &app,
        "$row = $app->db->insert('notes', $arg + ['updatedAt' => '2000-01-01T00:00:00.000Z'], true)[0];
         $next = $app->db->update('notes', ['priority' => 3], ['id' => $row['id']], true)[0];
         echo json_encode([$row['updatedAt'], $next['updatedAt'] > '2001']);",
        &base,
    );
    assert_eq!(rows, json!(["2000-01-01T00:00:00.000Z", true]));
}

#[test]
fn payload_literal_read_access_is_carried() {
    let (_dir, app, _) = payload_app();
    assert_eq!(
        run_php(
            &app,
            "echo json_encode($app->handle('GET', '/notes', [], '')[0]);",
            &Value::Null
        ),
        200
    );
}

#[test]
fn payload_number_bounds_are_carried() {
    let (_dir, app, base) = payload_app();
    assert_eq!(
        accepts(&app, base, json!([["priority", 5], ["priority", 6]])),
        json!([true, "/priority"])
    );
}

#[test]
fn payload_required_text_rejects_empty_strings() {
    let (_dir, app, base) = payload_app();
    assert_eq!(
        accepts(&app, base, json!([["title", ""], ["body", ""]])),
        json!(["/title", "/body"])
    );
}

#[test]
fn payload_required_multi_selects_reject_empty_lists() {
    let (_dir, app, base) = payload_app();
    assert_eq!(accepts(&app, base, json!([["tags", []]])), json!(["/tags"]));
}

#[test]
fn payload_required_json_must_be_truthy() {
    let (_dir, app, base) = payload_app();
    assert_eq!(
        accepts(
            &app,
            base,
            json!([["details", false], ["details", 0], ["details", ""], ["details", []], ["details", {"a": 1}]])
        ),
        json!(["/details", "/details", "/details", true, true])
    );
}

#[test]
fn payload_text_bounds_count_utf16_code_units() {
    let (_dir, app, base) = payload_app();
    // maxLength 120: 60 emoji are 120 code units, 61 are 122.
    assert_eq!(
        accepts(
            &app,
            base,
            json!([["title", "😀".repeat(60)], ["title", "😀".repeat(61)]])
        ),
        json!([true, "/title"])
    );
}

#[test]
fn payload_default_max_text_length_bounds_unbounded_text() {
    let (_dir, app, base) = payload_app();
    assert_eq!(
        accepts(
            &app,
            base,
            json!([["body", "a".repeat(40000)], ["body", "a".repeat(40001)]])
        ),
        json!([true, "/body"])
    );
}

#[test]
fn refuses_unsupported_constructs_at_their_pointer_without_output() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("source.ts");
    let out = dir.path().join("migrated/zero.config.ts");
    for (from, source, pointer) in [
        (
            "zero",
            "export default { collections: {}, queries: { mine: () => [] } };",
            "/queries/mine",
        ),
        ("zero", "export default { collections: {}, schema: {} };", "/schema"),
        (
            "zero",
            "export default {collections:{posts:{fields:{}}}};",
            "/collections/posts",
        ),
        (
            "payload",
            "export default { collections: [{slug:'notes',fields:[{name:'body',type:'richText'}]}] };",
            "/collections/0/fields/0/type",
        ),
        (
            "payload",
            "const notes = {slug:'notes',fields:[],access:{read: () => true}}; const collections = [notes]; export default { collections };",
            "/collections/0/access/read",
        ),
        (
            "payload",
            "const access = {'a/b~': () => true}; export default {collections:[{slug:'notes',fields:[],access}]};",
            "/collections/0/access/a~1b~0",
        ),
        (
            "payload",
            "const unused = {read: () => true}; export default {collections:[]};",
            "",
        ),
        (
            "payload",
            "export default {collections:[{slug:'notes',fields:[]},{slug:'notes',fields:[]}]};",
            "/collections/1",
        ),
        (
            "payload",
            "export default {collections:[{slug:'notes',fields:[{name:'title',type:'text'},{name:'title',type:'text'}]}]};",
            "/collections/0/fields/1",
        ),
        (
            "sanity",
            "export default {schema:{types:[{name:'notes',type:'document',fields:[{name:'link',type:'url'}]}]}};",
            "/schema/types/0/fields/0/type",
        ),
        (
            "sanity",
            "import {defineConfig} from 'sanity'; export default defineConfig({schema:{types:[]},plugins:[]});",
            "/plugins",
        ),
        (
            "emdash",
            "export default {version:'1',collections:[],content:{notes:[]}};",
            "/content",
        ),
        (
            "emdash",
            "export default {version:'1',collections:[{slug:'notes',fields:[{slug:'link',type:'url'}]}]};",
            "/collections/0/fields/0/type",
        ),
        (
            "payload",
            "export default {collections:[],collections:[]};",
            "/collections",
        ),
    ] {
        std::fs::write(&input, source).unwrap();
        let result = migrate(from, &input, &out);
        assert_eq!(
            result.status.code(),
            Some(1),
            "{}",
            String::from_utf8_lossy(&result.stdout)
        );
        let report: Value = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(report["errors"][0]["pointer"], pointer);
        assert!(!out.exists());
        assert!(!out.parent().unwrap().exists());
    }
}

/// Migrate `source` (written to `file`); expects a refusal and no output. Returns the first error.
fn refused(from: &str, file: &str, source: &str) -> Value {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join(file);
    std::fs::write(&input, source).unwrap();
    let out = dir.path().join("migrated/zero.config.ts");
    let result = migrate(from, &input, &out);
    assert_eq!(
        result.status.code(),
        Some(1),
        "{}",
        String::from_utf8_lossy(&result.stdout)
    );
    assert!(!out.parent().unwrap().exists());
    serde_json::from_slice::<Value>(&result.stdout).unwrap()["errors"][0].clone()
}

#[test]
fn a_config_the_compiler_rejects_is_never_published() {
    let error = refused(
        "payload",
        "source.ts",
        "export default {collections:[{slug:'notes',fields:[{name:'done',type:'checkbox',defaultValue:'invalid'}]}]};",
    );
    assert!(error["reason"].as_str().unwrap().contains("cannot compile"));
}

#[test]
fn nested_validation_errors_point_into_the_validation_object() {
    let error = refused(
        "sanity",
        "source.json",
        r#"{"schema":{"types":[{"name":"notes","type":"document","fields":[{"name":"title","type":"string","validation":{"required":"yes"}}]}]}}"#,
    );
    assert_eq!(error["pointer"], "/schema/types/0/fields/0/validation/required");
}

#[test]
fn json_exports_with_duplicate_keys_are_refused() {
    let error = refused("payload", "source.json", r#"{"collections":[],"collections":[]}"#);
    assert!(error["reason"].as_str().unwrap().contains("duplicate key"));
}

#[test]
fn source_code_is_never_executed() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("executed");
    refused(
        "payload",
        "source.ts",
        &format!(
            "import {{writeFileSync}} from 'node:fs'; writeFileSync({},'executed'); export default {{ collections: [] }};",
            serde_json::to_string(&marker.to_string_lossy()).unwrap()
        ),
    );
    assert!(!marker.exists());
}

/// Migrate one inline source and build it for WordPress; returns the wp-content directory.
fn migrated_app(from: &str, file: &str, source: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join(file);
    std::fs::write(&input, source).unwrap();
    let out = migrate(from, &input, &dir.path().join("app/zero.config.ts"));
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    let app = dir.path().join("wp-content");
    let build = zero()
        .args(["build", "--out"])
        .arg(&app)
        .arg(dir.path().join("app"))
        .output()
        .unwrap();
    assert!(build.status.success(), "{}", String::from_utf8_lossy(&build.stderr));
    (dir, app)
}

/// Insert each `{field: value}` case into `notes` (with `base` filled in), each in its own rolled-back
/// transaction so cases never see each other's rows; `true` = accepted, else the error pointer.
fn accepts(app: &Path, base: Value, cases: Value) -> Value {
    run_php(
        app,
        r#"
            [$base, $cases] = $arg;
            $out = [];
            foreach ($cases as [$field, $value]) {
                try {
                    $app->db->transaction(static function () use ($app, $field, $value, $base) {
                        $app->db->insert('notes', [$field => $value] + $base);
                        throw new \RuntimeException('accepted');
                    });
                } catch (\Zero\HttpError $e) { $out[] = $e->pointer; continue; }
                catch (\RuntimeException $e) { if ($e->getMessage() !== 'accepted') throw $e; }
                $out[] = true;
            }
            echo json_encode($out);
        "#,
        &json!([base, cases]),
    )
}

#[test]
fn payload_email_keeps_payloads_address_rule() {
    let (_dir, app) = migrated_app(
        "payload",
        "payload.ts",
        "export default {collections:[{slug:'notes',timestamps:false,fields:[{name:'title',type:'text',required:true},{name:'contact',type:'email'}]}]};",
    );
    assert_eq!(
        accepts(
            &app,
            json!({"title": "t"}),
            json!([
                ["contact", "user.name+alias@example.co.uk"],
                ["contact", "\"quoted\"@example.com"],
                ["contact", "user@[127.0.0.1]"],
                ["contact", format!("{}@example.com", "a".repeat(64))],
                ["contact", format!("{}@example.com", "a".repeat(65))]
            ])
        ),
        // A 65-character local part passes Payload's pattern but not PHP's check (reported for review).
        json!([true, "/contact", "/contact", true, "/contact"])
    );
}

#[test]
fn payload_dates_accept_what_date_parse_accepts() {
    let (_dir, app) = migrated_app(
        "payload",
        "payload.ts",
        "export default {collections:[{slug:'notes',timestamps:false,fields:[{name:'title',type:'text',required:true},{name:'due',type:'date'}]}]};",
    );
    assert_eq!(
        accepts(
            &app,
            json!({"title": "t"}),
            json!([
                ["due", "2026-01-01T10:00:00.000Z"],
                ["due", "2026-01-01"],
                ["due", "tomorrow"],
                // Date.parse rejects out-of-range times that PHP's parser would roll over.
                ["due", "2026-01-01T24:01:00Z"],
                ["due", "2026-01-01T00:00:00+24:00"],
                ["due", "2026-01-01T24:00:00.0001Z"]
            ])
        ),
        json!([true, true, "/due", "/due", "/due", "/due"])
    );
}

const EMDASH_DATETIME_SOURCE: &str = r#"{"version":"1","collections":[{"slug":"notes","fields":[{"slug":"title","type":"string","required":true},{"slug":"at","type":"datetime"}]}]}"#;
const SANITY_DATETIME_SOURCE: &str = r#"{"schema":{"types":[{"name":"notes","type":"document","fields":[{"name":"title","type":"string"},{"name":"at","type":"datetime"}]}]}}"#;

/// The review text reported for a migrated field.
fn field_review(from: &str, file: &str, source: &str, field_pointer: &str) -> String {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join(file);
    std::fs::write(&input, source).unwrap();
    let out = migrate(from, &input, &dir.path().join("app/zero.config.ts"));
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    report["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["pointer"] == field_pointer && e["outcome"] == "review")
        .map(|e| e["reason"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn imported_datetimes_are_timestamp_columns() {
    for (from, file, source) in [
        ("emdash", "emdash.json", EMDASH_DATETIME_SOURCE),
        ("sanity", "sanity.json", SANITY_DATETIME_SOURCE),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join(file);
        std::fs::write(&input, source).unwrap();
        assert!(
            migrate(from, &input, &dir.path().join("app/zero.config.ts"))
                .status
                .success()
        );
        let built = build_fixture(&dir.path().join("app"));
        assert_eq!(
            schema(&built.join("plugins/zero-app-imported/zero/app/schema.php"))["collections"]["notes"]["columns"]["at"]
                ["type"],
            "timestamp",
            "{from}"
        );
    }
}

#[test]
fn imported_datetime_reports_state_zeros_grammar_and_storage() {
    for (from, file, source, pointer) in [
        (
            "emdash",
            "emdash.json",
            EMDASH_DATETIME_SOURCE,
            "/collections/0/fields/1",
        ),
        (
            "sanity",
            "sanity.json",
            SANITY_DATETIME_SOURCE,
            "/schema/types/0/fields/1",
        ),
    ] {
        let reason = field_review(from, file, source, pointer);
        for disclosed in [
            "accept exactly YYYY-MM-DD",
            "epoch milliseconds",
            "0000-9999",
            "millisecond precision",
            "whole seconds",
        ] {
            assert!(reason.contains(disclosed), "{from} {disclosed}: {reason}");
        }
    }
}

#[test]
fn emdash_datetime_report_names_what_emdash_refused() {
    let reason = field_review(
        "emdash",
        "emdash.json",
        EMDASH_DATETIME_SOURCE,
        "/collections/0/fields/1",
    );
    assert!(reason.contains("a date alone"), "{reason}");
}

#[test]
fn sanity_datetime_report_names_the_forms_now_refused() {
    let reason = field_review(
        "sanity",
        "sanity.json",
        SANITY_DATETIME_SOURCE,
        "/schema/types/0/fields/1",
    );
    assert!(reason.contains("all now refused"), "{reason}");
}

/// The codec's grammar is held by tests/php/schema_test.php; these prove the imported column uses it.
#[test]
fn imported_datetimes_refuse_bad_dates_through_the_generated_app() {
    for (from, file, source) in [
        ("emdash", "emdash.json", EMDASH_DATETIME_SOURCE),
        ("sanity", "sanity.json", SANITY_DATETIME_SOURCE),
    ] {
        let (_dir, app) = migrated_app(from, file, source);
        assert_eq!(
            accepts(
                &app,
                json!({"title": "t"}),
                json!([
                    ["at", "2026-01-01T10:00:00Z"],
                    ["at", "2026-02-30T00:00:00Z"],
                    ["at", "2026-W05-3"]
                ])
            ),
            json!([true, "/at", "/at"]),
            "{from}"
        );
    }
}

#[test]
fn imported_datetimes_store_utc() {
    // The imported collection has a title, so it is post-backed: its timestamp lives in SCF's picker
    // field, which keeps whole seconds (custom tables keep milliseconds; tests/php/db_test.php).
    let (_dir, app) = migrated_app("emdash", "emdash.json", EMDASH_DATETIME_SOURCE);
    let stored = run_php(
        &app,
        "echo json_encode($app->db->insert('notes', $arg, true)[0]['at']);",
        &json!({"title": "t", "at": "2024-02-29T10:00:00.123456+02:00"}),
    );
    assert_eq!(stored, "2024-02-29T08:00:00.000Z");
}

#[test]
fn emdash_integers_stay_within_zods_safe_integer_range() {
    // `n` declares nothing, `wide` declares bounds past the safe range, `tight` declares a narrower one.
    let (_dir, app) = migrated_app(
        "emdash",
        "emdash.json",
        r#"{"version":"1","collections":[{"slug":"notes","fields":[{"slug":"title","type":"string","required":true},{"slug":"n","type":"integer"},{"slug":"wide","type":"integer","min":-1e20,"max":1e20},{"slug":"tight","type":"integer","min":0,"max":10}]}]}"#,
    );
    let over = 9007199254740992u64;
    assert_eq!(
        accepts(
            &app,
            json!({"title": "t"}),
            json!([
                ["n", 9007199254740991u64],
                ["n", -9007199254740991i64],
                ["n", over],
                ["n", -9007199254740992i64],
                ["wide", 9007199254740991u64],
                ["wide", over],
                ["tight", 10],
                ["tight", 11]
            ])
        ),
        json!([true, true, "/n", "/n", true, "/wide", true, "/tight"])
    );
}

#[test]
fn emdash_booleans_report_that_numeric_flags_are_refused() {
    let source = r#"{"version":"1","collections":[{"slug":"notes","fields":[{"slug":"title","type":"string","required":true},{"slug":"done","type":"boolean"}]}]}"#;
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("emdash.json");
    std::fs::write(&input, source).unwrap();
    let out = migrate("emdash", &input, &dir.path().join("report/zero.config.ts"));
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(
        report["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["pointer"] == "/collections/0/fields/1"
                && e["outcome"] == "review"
                && e["reason"].as_str().unwrap().contains("0/1"))
    );
    let (_dir, app) = migrated_app("emdash", "emdash.json", source);
    assert_eq!(
        accepts(
            &app,
            json!({"title": "t"}),
            json!([["done", true], ["done", 1], ["done", 0]])
        ),
        json!([true, "/done", "/done"])
    );
}

#[test]
fn emdash_required_json_rejects_only_the_empty_string() {
    let (_dir, app) = migrated_app(
        "emdash",
        "emdash.json",
        r#"{"version":"1","collections":[{"slug":"notes","fields":[{"slug":"title","type":"string","required":true},{"slug":"data","type":"json","required":true}]}]}"#,
    );
    assert_eq!(
        accepts(
            &app,
            json!({"title": "t"}),
            json!([["data", ""], ["data", false], ["data", 0], ["data", []], ["data", {"a": 1}]])
        ),
        json!(["/data", true, true, true, true])
    );
}

#[test]
fn json_defaults_keep_numeric_keyed_objects() {
    let (_dir, app) = migrated_app(
        "emdash",
        "emdash.json",
        r#"{"version":"1","collections":[{"slug":"notes","fields":[{"slug":"title","type":"string","required":true},{"slug":"data","type":"json","defaultValue":{"nested":{"1":"b","0":"a"}}}]}]}"#,
    );
    let out = Command::new("php")
        .args([
            "-r",
            r#"
        require $argv[1] . '/zero/runtime/bootstrap.php';
        $app = \Zero\App::boot($argv[1]);
        echo \Zero\Js::jsonStringify($app->db->insert('notes', ['title' => 't'], true)[0]['data']);
    "#,
        ])
        .arg(&app)
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(
        serde_json::from_slice::<Value>(&out.stdout).unwrap(),
        json!({"nested": {"0": "a", "1": "b"}})
    );
}

/// A migrated original-Zero app with a required `project` and an optional self `helper` reference,
/// plus one project, a helper task and a task pointing at both.
fn reference_app() -> (tempfile::TempDir, PathBuf) {
    migrated_app(
        "zero",
        "capsule.ts",
        r#"import { capsule } from "@spacefast/zero/server";
export default capsule({ collections: {
  tasks: { fields: { title: { kind: "text", required: true }, project: { kind: "reference", to: "projects", required: true }, helper: { kind: "reference", to: "tasks" } } },
  projects: { fields: { title: { kind: "text", required: true } } },
} });"#,
    )
}
const REFERENCE_SEED: &str = "$p = $app->db->insert('projects', ['title' => 'P'], true)[0];
    $helper = $app->db->insert('tasks', ['title' => 'Helper', 'projectId' => $p['id']], true)[0];
    $task = $app->db->insert('tasks', ['title' => 'T', 'projectId' => $p['id'], 'helperId' => $helper['id']], true)[0];";

#[test]
fn original_zero_references_type_check_as_written() {
    // Self and circular references need an annotated callback (types/zero: `(): AnyColumn => ...`)
    // or strict TypeScript loses the collection types (TS7022/TS7024).
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("capsule.ts");
    std::fs::write(
        &input,
        r#"import { capsule } from "@spacefast/zero/server";
export default capsule({ collections: {
  tasks: { fields: { title: { kind: "text", required: true }, project: { kind: "reference", to: "projects", required: true }, helper: { kind: "reference", to: "tasks" } } },
  projects: { fields: { title: { kind: "text", required: true }, lead: { kind: "reference", to: "tasks" } } },
} });"#,
    )
    .unwrap();
    let config = dir.path().join("app/zero.config.ts");
    assert!(migrate("zero", &input, &config).status.success());
    let types = Path::new(env!("CARGO_MANIFEST_DIR")).join("types/zero/index.d.ts");
    std::fs::write(
        dir.path().join("app/tsconfig.json"),
        json!({"compilerOptions": {"target": "ES2022", "lib": ["ES2022"], "module": "ESNext", "moduleResolution": "bundler", "strict": true, "noEmit": true, "types": [], "paths": {"zero": [types]}}, "include": ["zero.config.ts"]}).to_string(),
    )
    .unwrap();
    let out = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .arg("-p")
        .arg(dir.path().join("app"))
        .output()
        .expect("tsc (or TSC) must be installed to check generated configs");
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn original_zero_references_resolve_with_relations() {
    let (_dir, app) = reference_app();
    let read = run_php(
        &app,
        &format!(
            "{REFERENCE_SEED} $r = $app->db->findFirst('tasks', ['where' => ['id' => $task['id']], 'with' => ['project' => true, 'helper' => true]]); echo json_encode([$r['project']['title'], $r['helper']['title']]);"
        ),
        &Value::Null,
    );
    assert_eq!(read, json!(["P", "Helper"]));
}

#[test]
fn original_zero_required_references_block_deleting_their_target() {
    let (_dir, app) = reference_app();
    let error = run_php(
        &app,
        &format!(
            "{REFERENCE_SEED} try {{ $app->db->delete('projects', ['id' => $p['id']]); echo 'null'; }} catch (\\Zero\\HttpError $e) {{ echo json_encode([$e->status, $e->errorCode]); }}"
        ),
        &Value::Null,
    );
    assert_eq!(error, json!([409, "reference_violation"]));
}

#[test]
fn original_zero_optional_references_clear_when_their_target_goes() {
    let (_dir, app) = reference_app();
    let cleared = run_php(
        &app,
        &format!(
            "{REFERENCE_SEED} $app->db->delete('tasks', ['id' => $helper['id']]); echo json_encode($app->db->findFirst('tasks', ['where' => ['id' => $task['id']]])['helperId']);"
        ),
        &Value::Null,
    );
    assert_eq!(cleared, Value::Null);
}

#[test]
fn original_zero_media_fields_keep_their_cardinality() {
    let (_dir, app) = migrated_app(
        "zero",
        "capsule.ts",
        r#"import { capsule } from "@spacefast/zero/server";
export default capsule({ collections: { notes: { fields: { title: { kind: "text", required: true }, cover: { kind: "media" }, gallery: { kind: "media", multiple: true, required: true } } } } });"#,
    );
    let columns =
        &schema(&app.join("plugins/zero-app-imported/zero/app/schema.php"))["collections"]["notes"]["columns"];
    assert_eq!(columns["cover"], json!({"type": "media", "accept": "any"}));
    assert_eq!(
        columns["gallery"],
        json!({"type": "mediaList", "accept": "any", "notNull": true, "rules": {"min": 1}})
    );
}

#[test]
fn original_zero_multiple_references_are_refused_at_the_field() {
    let error = refused(
        "zero",
        "capsule.ts",
        r#"import { capsule } from "@spacefast/zero/server";
export default capsule({ collections: { notes: { fields: { title: { kind: "text", required: true }, related: { kind: "reference", to: "notes", multiple: true } } } } });"#,
    );
    assert_eq!(error["pointer"], "/collections/notes/fields/related/multiple");
}

#[test]
fn payload_presentation_metadata_is_preserved_and_unknown_admin_behavior_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let input = tmp.path().join("payload.json");
    let document = json!({"collections": [{"slug": "notes", "fields": [{
        "name": "title", "type": "text", "required": true, "label": "Headline",
        "admin": {"description": "Shown in search", "placeholder": "Write a title", "width": "50%"}
    }]}]});
    std::fs::write(&input, document.to_string()).unwrap();
    let project = tmp.path().join("imported");
    let out = migrate("payload", &input, &project.join("zero.config.ts"));
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(
        report["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| { e["pointer"] == "/collections/0/fields/0/admin/width" && e["outcome"] == "mapped" })
    );
    let built = build_fixture(&project);
    let schema = schema(&built.join("plugins/zero-app-imported/zero/app/schema.php"));
    assert_eq!(
        schema["collections"]["notes"]["columns"]["title"]["ui"],
        json!({"label": "Headline", "help": "Shown in search", "placeholder": "Write a title", "width": 50})
    );

    for admin in [
        json!({"readOnly": true}),
        json!({"width": "calc(50%)"}),
        json!({"width": "0%"}),
        json!({"description": false}),
    ] {
        let mut invalid = document.clone();
        invalid["collections"][0]["fields"][0]["admin"] = admin;
        std::fs::write(&input, invalid.to_string()).unwrap();
        let out = migrate("payload", &input, &tmp.path().join("refused/zero.config.ts"));
        assert!(!out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
        assert!(!tmp.path().join("refused/zero.config.ts").exists());
    }
}
