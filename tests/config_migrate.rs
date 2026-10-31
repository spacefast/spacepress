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

/// Run PHP against the generated app with `$app` booted; returns its JSON output.
fn run_php(app: &Path, body: &str, arg: &Value) -> Value {
    let out = Command::new("php")
        .args(["-r", &format!("require $argv[1] . '/zero/runtime/bootstrap.php'; $app = \\Zero\\App::boot($argv[1]); $arg = json_decode($argv[2], true); {body}")])
        .arg(app)
        .arg(arg.to_string())
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
}

#[test]
fn payload_defaults_survive_the_import() {
    let (_dir, app, base) = payload_app();
    let row = run_php(
        &app,
        "echo json_encode($app->db->insert('notes', $arg, true)[0]);",
        &base,
    );
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
fn payload_required_text_and_lists_reject_empty_values() {
    let (_dir, app, base) = payload_app();
    assert_eq!(
        accepts(&app, base, json!([["title", ""], ["body", ""], ["tags", []]])),
        json!(["/title", "/body", "/tags"])
    );
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

/// Insert each `{field: value}` case into `notes` (with `base` filled in), each in its own rolled-back
/// transaction so cases never see each other's rows; `true` = accepted, else the error pointer.
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
                ["due", "2026-01-01T00:00:00+24:00"],
                ["due", "2026-01-01T24:00:00.0001Z"]
            ])
        ),
        json!([true, true, "/due", "/due", "/due", "/due"])
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
        r#"{"version":"1","collections":[{"slug":"notes","fields":[{"slug":"title","type":"string","required":true},{"slug":"data","type":"json","defaultValue":{"nested":{"1":"b","0":"a"}}}]}]}"#,
    )
    .unwrap();
    let out = migrate("emdash", &input, &dir.path().join("app/zero.config.ts"));
    assert_eq!(out.status.code(), Some(1));
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(report["errors"][0]["pointer"], "/collections/0/fields/1/defaultValue");
    assert!(!dir.path().join("app").exists());
}
