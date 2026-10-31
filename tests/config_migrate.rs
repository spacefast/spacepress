//! Config importer owner: run the CLI, compile the result, load emitted PHP metadata.
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

fn build_fixture(dir: &Path, target: &str) -> PathBuf {
    let out = dir.join(target);
    let build = zero()
        .args(["build", "--target", target, "--out"])
        .arg(&out)
        .arg(dir)
        .output()
        .unwrap();
    assert!(
        build.status.success(),
        "{target}: {}",
        String::from_utf8_lossy(&build.stderr)
    );
    out
}

#[test]
fn each_source_compiles_for_both_targets_with_its_storage_and_access() {
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
        for (target, schema_php) in [
            ("wp", format!("plugins/{plugin}/zero/app/schema.php")),
            ("standalone", "zero/app/schema.php".into()),
        ] {
            let data = schema(&build_fixture(dir.path(), target).join(schema_php));
            let notes = &data["collections"]["notes"];
            assert_eq!(notes["editor"], true, "{from}/{target}");
            assert_eq!(notes["columns"]["title"]["notNull"], true);
            assert_eq!(notes["access"]["read"]["allow"], json!(public), "{from}/{target}");
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
        let app = build_fixture(dir.path(), "standalone");
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

/// The Payload fixture built for standalone, plus a valid row's base values.
fn payload_app() -> (tempfile::TempDir, PathBuf, Value) {
    let (dir, _) = migrate_fixture("payload", "payload.ts");
    let app = build_fixture(dir.path(), "standalone");
    (dir, app, json!({"title": "Title", "body": "Body", "tags": ["one"]}))
}

#[test]
fn payload_defaults_survive_the_import() {
    let (dir, app, base) = payload_app();
    let notes = &schema(&build_fixture(dir.path(), "wp").join("plugins/zero-app-imported/zero/app/schema.php"))["collections"]
        ["notes"];
    assert_eq!(notes["columns"]["updatedAt"]["onUpdate"]["now"], true);
    let out = Command::new("php")
        .args([
            "-r",
            "require $argv[1] . '/zero/runtime/bootstrap.php'; echo json_encode(\\Zero\\App::boot($argv[1])->db->insert('notes', json_decode($argv[2], true), true)[0]);",
        ])
        .arg(&app)
        .arg(base.to_string())
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let row: Value = serde_json::from_slice(&out.stdout).unwrap();
    // Declared defaults, a required checkbox's implicit false, and an optional checkbox's absence.
    assert_eq!(
        [
            &row["priority"],
            &row["stage"],
            &row["done"],
            &row["archived"],
            &row["details"]
        ],
        [&json!(2), &json!("todo"), &json!(false), &Value::Null, &json!([])]
    );
}

#[test]
fn payload_literal_read_access_is_carried() {
    let (_dir, app, _) = payload_app();
    let out = Command::new("php")
        .args(["-r", "require $argv[1] . '/zero/runtime/bootstrap.php'; echo \\Zero\\App::boot($argv[1])->handle('GET', '/notes', [], '')[0];"])
        .arg(&app)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&out.stdout), "200");
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
fn payload_required_values_reject_payloads_empty_forms() {
    let (_dir, app, base) = payload_app();
    assert_eq!(
        accepts(
            &app,
            base,
            json!([["title", ""], ["body", ""], ["tags", []], ["details", false]])
        ),
        json!(["/title", "/body", "/tags", "/details"])
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
fn refuses_behavior_loss_dynamic_code_and_ambiguous_names_without_output() {
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
    std::fs::write(
        &input,
        "export default {collections:[{slug:'notes',fields:[{name:'done',type:'checkbox',defaultValue:'invalid'}]}]};",
    )
    .unwrap();
    let invalid = migrate("payload", &input, &out);
    assert_eq!(invalid.status.code(), Some(1));
    let report: Value = serde_json::from_slice(&invalid.stdout).unwrap();
    assert!(
        report["errors"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("cannot compile")
    );
    assert!(!out.exists());
    let json_input = dir.path().join("duplicate.json");
    // A nested validation error points into the validation object, not at the field.
    std::fs::write(
        &json_input,
        r#"{"schema":{"types":[{"name":"notes","type":"document","fields":[{"name":"title","type":"string","validation":{"required":"yes"}}]}]}}"#,
    )
    .unwrap();
    let nested = migrate("sanity", &json_input, &out);
    assert_eq!(nested.status.code(), Some(1));
    let report: Value = serde_json::from_slice(&nested.stdout).unwrap();
    assert_eq!(
        report["errors"][0]["pointer"],
        "/schema/types/0/fields/0/validation/required"
    );
    assert!(!out.exists());
    std::fs::write(&json_input, r#"{"collections":[],"collections":[]}"#).unwrap();
    let duplicate = migrate("payload", &json_input, &out);
    assert_eq!(duplicate.status.code(), Some(1));
    let report: Value = serde_json::from_slice(&duplicate.stdout).unwrap();
    assert!(
        report["errors"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("duplicate key")
    );
    assert!(!out.exists());
    // An arbitrary source call must not execute, even before the default export.
    let marker = dir.path().join("executed");
    std::fs::write(&input, format!("import {{writeFileSync}} from 'node:fs'; writeFileSync({},'executed'); export default {{ collections: [] }};", serde_json::to_string(&marker.to_string_lossy()).unwrap())).unwrap();
    let result = migrate("payload", &input, &out);
    assert_eq!(result.status.code(), Some(1));
    assert!(!marker.exists());
    assert!(!out.exists());
}

/// Migrate one inline source and build it for standalone; returns the app directory.
fn migrated_app(from: &str, file: &str, source: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join(file);
    std::fs::write(&input, source).unwrap();
    let out = migrate(from, &input, &dir.path().join("app/zero.config.ts"));
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    let app = dir.path().join("standalone");
    let build = zero()
        .args(["build", "--target", "standalone", "--out"])
        .arg(&app)
        .arg(dir.path().join("app"))
        .output()
        .unwrap();
    assert!(build.status.success(), "{}", String::from_utf8_lossy(&build.stderr));
    (dir, app)
}

/// Insert each `{field: value}` case into `notes` (with `base` filled in); `true` = accepted.
fn accepts(app: &Path, base: Value, cases: Value) -> Value {
    let out = Command::new("php")
        .args([
            "-r",
            r#"
            require $argv[1] . '/zero/runtime/bootstrap.php';
            $app = \Zero\App::boot($argv[1]);
            $base = json_decode($argv[2], true);
            $out = [];
            foreach (json_decode($argv[3], true) as [$field, $value]) {
                try { $app->db->insert('notes', [$field => $value] + $base); $out[] = true; }
                catch (\Zero\HttpError $e) { $out[] = $e->pointer; }
            }
            echo json_encode($out);
        "#,
        ])
        .arg(app)
        .arg(base.to_string())
        .arg(cases.to_string())
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
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
                ["due", "2026-01-01T00:00:00+24:00"]
            ])
        ),
        json!([true, true, "/due", "/due", "/due"])
    );
}

#[test]
fn emdash_datetime_keeps_its_iso_format_and_calendar() {
    let (_dir, app) = migrated_app(
        "emdash",
        "emdash.json",
        r#"{"version":"1","collections":[{"slug":"notes","fields":[{"slug":"title","type":"string","required":true},{"slug":"at","type":"datetime"}]}]}"#,
    );
    assert_eq!(
        accepts(
            &app,
            json!({"title": "t"}),
            json!([
                ["at", "2024-02-29T10:00:00.5+02:00"],
                ["at", "2026-01-01T00:00Z"],
                ["at", "2026-02-30T00:00:00Z"],
                ["at", "tomorrow"],
                ["at", 1700000000000u64],
                ["at", "2026-01-01T00:00:00"]
            ])
        ),
        json!([true, true, "/at", "/at", "/at", "/at"])
    );
}

#[test]
fn sanity_datetime_keeps_sanitys_iso_rule_and_rejects_numbers() {
    let (_dir, app) = migrated_app(
        "sanity",
        "sanity.json",
        r#"{"schema":{"types":[{"name":"notes","type":"document","fields":[{"name":"title","type":"string"},{"name":"at","type":"datetime"}]}]}}"#,
    );
    assert_eq!(
        accepts(
            &app,
            json!({"title": "t"}),
            json!([
                ["at", "2026-01-01T10:00:00+02:00"],
                ["at", "2026-W05-3"],
                ["at", 1700000000000u64],
                ["at", "tomorrow"]
            ])
        ),
        json!([true, true, "/at", "/at"])
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
fn json_defaults_with_list_shaped_objects_are_refused_at_the_default() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("emdash.json");
    std::fs::write(
        &input,
        r#"{"version":"1","collections":[{"slug":"notes","fields":[{"slug":"title","type":"string","required":true},{"slug":"data","type":"json","defaultValue":{"nested":{"0":"a","1":"b"}}}]}]}"#,
    )
    .unwrap();
    let out = migrate("emdash", &input, &dir.path().join("app/zero.config.ts"));
    assert_eq!(out.status.code(), Some(1));
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(report["errors"][0]["pointer"], "/collections/0/fields/1/defaultValue");
    assert!(!dir.path().join("app").exists());
}
