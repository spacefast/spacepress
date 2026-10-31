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

#[test]
fn imports_each_source_into_a_real_compilable_wordpress_and_php_app() {
    for (from, file) in [
        ("emdash", "emdash.json"),
        ("payload", "payload.ts"),
        ("sanity", "sanity.ts"),
        ("zero", "legacy-zero.ts"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let input = fixture(file);
        let original = std::fs::read(&input).unwrap();
        let out = migrate(from, &input, &dir.path().join("zero.config.ts"));
        assert!(
            out.status.success(),
            "{from}: {}\n{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        let report: Value = serde_json::from_slice(&out.stdout).unwrap();
        assert_eq!(report["status"], "written");
        assert!(
            report["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["outcome"] == "review")
        );
        if from == "payload" {
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
        for target in ["wp", "standalone"] {
            let build = zero()
                .args(["build", "--target", target, "--out"])
                .arg(dir.path().join(target))
                .arg(dir.path())
                .output()
                .unwrap();
            assert!(
                build.status.success(),
                "{from}/{target}: {}",
                String::from_utf8_lossy(&build.stderr)
            );
            let plugin = if target == "wp" {
                if from == "zero" {
                    "plugins/zero-app-notes/"
                } else {
                    "plugins/zero-app-imported/"
                }
            } else {
                ""
            };
            let data = schema(&dir.path().join(target).join(plugin).join("zero/app/schema.php"));
            let notes = &data["collections"]["notes"];
            assert_eq!(notes["editor"], true);
            assert_eq!(notes["columns"]["title"]["notNull"], true);
            assert_eq!(
                notes["access"]["read"]["allow"],
                if from == "zero" || from == "payload" {
                    json!(true)
                } else {
                    json!(false)
                }
            );
            assert_eq!(notes["access"]["create"]["allow"], false);
            if matches!(from, "sanity" | "emdash") && target == "standalone" {
                let runtime = Command::new("php")
                    .args([
                        "-r",
                        r#"
                    require $argv[1] . '/zero/runtime/bootstrap.php';
                    $app = \Zero\App::boot($argv[1]);
                    $valid = ['title' => 'Title'];
                    if ($argv[2] === 'emdash') $valid['description'] = 'Description';
                    $app->db->insert('notes', $valid);
                    $errors = [];
                    foreach ($valid as $field => $_) {
                        $values = $valid;
                        $values[$field] = '';
                        try { $app->db->insert('notes', $values); }
                        catch (\Zero\HttpError $e) { $errors[$field] = [$e->status, $e->pointer]; }
                    }
                    echo json_encode($errors);
                "#,
                    ])
                    .arg(dir.path().join(target))
                    .arg(from)
                    .output()
                    .unwrap();
                assert!(runtime.status.success(), "{}", String::from_utf8_lossy(&runtime.stderr));
                assert_eq!(
                    serde_json::from_slice::<Value>(&runtime.stdout).unwrap(),
                    if from == "emdash" {
                        json!({"title": [422, "/title"], "description": [422, "/description"]})
                    } else {
                        json!({"title": [422, "/title"]})
                    }
                );
            }
            if from == "payload" {
                assert_eq!(notes["columns"]["priority"]["default"]["value"], 2);
                assert_eq!(notes["columns"]["updatedAt"]["onUpdate"]["now"], true);
                if target == "standalone" {
                    let runtime = Command::new("php")
                        .args([
                            "-r",
                            r#"
                        require $argv[1] . '/zero/runtime/bootstrap.php';
                        $app = \Zero\App::boot($argv[1]);
                        $row = $app->db->insert('notes', ['title' => 'Imported', 'body' => 'Body', 'tags' => ['one']], true)[0];
                        try { $app->db->insert('notes', ['title' => 'Invalid', 'body' => 'Body', 'tags' => ['one'], 'priority' => 6]); }
                        catch (\Zero\HttpError $e) { $error = $e->getMessage(); }
                        $required = [];
                        foreach (['title' => '', 'body' => '', 'tags' => [], 'details' => false] as $field => $empty) {
                            $values = ['title' => 'Title', 'body' => 'Body', 'tags' => ['one']];
                            $values[$field] = $empty;
                            try { $app->db->insert('notes', $values); }
                            catch (\Zero\HttpError $e) { $required[$field] = [$e->status, $e->pointer]; }
                        }
                        $app->db->insert('notes', ['title' => str_repeat('😀', 60), 'body' => 'Body', 'tags' => ['one']]);
                        try { $app->db->insert('notes', ['title' => str_repeat('😀', 61), 'body' => 'Body', 'tags' => ['one']]); }
                        catch (\Zero\HttpError $e) { $bound = [$e->status, $e->pointer]; }
                        // Payload's defaultMaxTextLength bounds a textarea that declares no maxLength.
                        $app->db->insert('notes', ['title' => 'Long', 'body' => str_repeat('a', 40000), 'tags' => ['one']]);
                        try { $app->db->insert('notes', ['title' => 'Longer', 'body' => str_repeat('a', 40001), 'tags' => ['one']]); }
                        catch (\Zero\HttpError $e) { $implicit = [$e->status, $e->pointer]; }
                        $response = $app->handle('GET', '/notes', [], '');
                        echo json_encode(['row' => $row, 'error' => $error ?? null, 'status' => $response[0], 'required' => $required, 'bound' => $bound ?? null, 'implicit' => $implicit ?? null]);
                    "#,
                        ])
                        .arg(dir.path().join(target))
                        .output()
                        .unwrap();
                    assert!(runtime.status.success(), "{}", String::from_utf8_lossy(&runtime.stderr));
                    let result: Value = serde_json::from_slice(&runtime.stdout).unwrap();
                    assert_eq!(result["row"]["priority"], 2);
                    assert_eq!(result["row"]["stage"], "todo");
                    assert_eq!(result["row"]["done"], false);
                    assert_eq!(result["row"]["archived"], Value::Null);
                    assert_eq!(result["row"]["details"], json!([]));
                    assert!(result["error"].as_str().unwrap().contains('5'));
                    assert_eq!(result["status"], 200);
                    for field in ["title", "body", "tags", "details"] {
                        assert_eq!(result["required"][field], json!([422, format!("/{field}")]));
                    }
                    assert_eq!(result["bound"], json!([422, "/title"]));
                    assert_eq!(result["implicit"], json!([422, "/body"]));
                }
            }
        }
        assert_eq!(std::fs::read(input).unwrap(), original);
        let before = std::fs::read(dir.path().join("zero.config.ts")).unwrap();
        let collision = migrate(from, &fixture(file), &dir.path().join("zero.config.ts"));
        assert_eq!(collision.status.code(), Some(1));
        assert_eq!(std::fs::read(dir.path().join("zero.config.ts")).unwrap(), before);
    }
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

#[test]
fn json_defaults_with_empty_objects_are_refused_at_the_default() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("emdash.json");
    std::fs::write(
        &input,
        r#"{"version":"1","collections":[{"slug":"notes","fields":[{"slug":"title","type":"string","required":true},{"slug":"data","type":"json","defaultValue":{"nested":{}}}]}]}"#,
    )
    .unwrap();
    let out = migrate("emdash", &input, &dir.path().join("app/zero.config.ts"));
    assert_eq!(out.status.code(), Some(1));
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(report["errors"][0]["pointer"], "/collections/0/fields/1/defaultValue");
    assert!(!dir.path().join("app").exists());
}
