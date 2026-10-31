//! Runs the real `zero` binary. Rejections are checked by message and
//! location; the pantry example is built, served with `php -S`, and driven
//! over HTTP so hooks and actions are proven by their effects in PHP.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

fn zero() -> Command {
    Command::new(env!("CARGO_BIN_EXE_zero"))
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// `zero check` on a fixture must fail with `message` at `file:line`.
fn rejects(fixture: &str, message: &str, at: &str) {
    let out = zero()
        .args(["check"])
        .arg(root().join("tests/fixtures").join(fixture))
        .output()
        .expect("run zero");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{fixture} should fail, got:\n{stderr}");
    assert!(
        stderr.contains(message),
        "{fixture}: expected {message:?} in:\n{stderr}"
    );
    assert!(
        stderr.contains(&format!("--> {at}")),
        "{fixture}: expected location {at} in:\n{stderr}"
    );
}

#[test]
fn rejects_code_outside_the_subset_with_a_location_and_fix() {
    rejects(
        "reject-class",
        "Zero code doesn't support classes",
        "zero.config.ts:2:1",
    );
    rejects(
        "reject-npm-import",
        "can't import \"dayjs\": npm packages aren't supported yet",
        "zero.config.ts:1:1",
    );
    rejects(
        "reject-build-time-clock",
        "`Date.now()` isn't available while the config is evaluated",
        "zero.config.ts:2:11",
    );
    rejects("reject-infinite-loop", "step budget exceeded", "zero.config.ts:2:");
}

#[test]
fn rejects_schema_mistakes_against_the_evaluated_config() {
    rejects(
        "reject-hook-typo",
        "there's no hook called `beforeCreat`",
        "zero.config.ts:3:",
    );
    rejects(
        "reject-bad-reference",
        "`aName` is integer() but references a.name, which is text()",
        "zero.config.ts:3:56",
    );
    // §1.2: modifiers per column kind, pointing at the modifier call.
    rejects(
        "reject-modifier-kind",
        "`.max()` isn't valid on a boolean column",
        "zero.config.ts:2:55",
    );
    // §1.3: sub-fields hold plain values.
    rejects(
        "reject-subfield-unique",
        "`.unique()` isn't allowed inside a group, repeater, or blocks field (`code`)",
        "zero.config.ts:2:76",
    );
    // §1.4: what an editor (post-backed) collection needs, and the names WordPress can't hold.
    rejects(
        "reject-editor-no-title",
        "editor collection \"notes\" has no title",
        "zero.config.ts:2:15",
    );
    rejects("reject-reserved-name", "\"media\" is reserved", "zero.config.ts:2:15");
    rejects("reject-reserved-files", "\"files\" is reserved", "zero.config.ts:2:15");
    rejects(
        "reject-post-type-length",
        "WordPress post types are limited to 20 characters and Zero prefixes `zero_`",
        "zero.config.ts:2:18",
    );
    rejects(
        "reject-unique-length",
        "unique text columns are limited to 191 characters on MySQL (`code`); add `.max(191)`",
        "zero.config.ts:2:52",
    );
    rejects(
        "reject-drafts-reserved",
        "`status` is reserved: drafts add these",
        "zero.config.ts:2:80",
    );
    // §1.5
    rejects(
        "reject-global-required",
        "global fields that are notNull need a default (`title`)",
        "zero.config.ts:3:38",
    );
    // PHP decodes {} and "0".."n" keyed objects as lists, in a json() column or a json sub-field;
    // group defaults are normalized against their fields and stay valid.
    rejects(
        "reject-json-list-shaped-default",
        "`meta` defaults to a JSON object that the PHP runtime reads back as an array",
        "zero.config.ts:2:",
    );
    rejects(
        "reject-json-list-shaped-object",
        "`meta` defaults to a JSON object that the PHP runtime reads back as an array",
        "zero.config.ts:3:",
    ); // Literal defaults follow the strict ISO timestamp codec, inside structured columns too.
    rejects(
        "reject-default-timestamp",
        "`when` defaults to a `at` value that isn't a real ISO 8601 date or timestamp",
        "zero.config.ts:4:",
    );
}

#[test]
fn rejects_hooks_that_would_misbehave_in_php() {
    rejects(
        "reject-filter-column",
        "\"a\" has no column or relation `nmae`",
        "zero.config.ts:5:",
    );
    rejects(
        "reject-ambiguous-plus",
        "`+` between number and unknown | null is ambiguous",
        "zero.config.ts:3:",
    );
    rejects(
        "reject-missing-await",
        "this database call never runs",
        "zero.config.ts:5:",
    );
    rejects("reject-module-state", "hooks can't change `count`", "zero.config.ts:4:");
    rejects(
        "reject-maybe-null",
        "can't read `length`: this might be null",
        "zero.config.ts:3:",
    );
    rejects(
        "reject-missing-insert-field",
        "missing required field `x`",
        "zero.config.ts:5:",
    );
    // §3.5: literal filters use the runtime's operator rules and its exact message.
    rejects(
        "reject-list-operator",
        "`in` isn't supported on list columns; use `has`",
        "zero.config.ts:5:",
    );
    // db.globals is typed from the global's fields, like db.query from a collection's.
    rejects(
        "reject-db-globals-key",
        "`db.globals.setings` doesn't match a global in `globals`",
        "zero.config.ts:4:",
    );
    rejects(
        "reject-db-globals-patch",
        "`stats` must be { visits: number } | null, not number",
        "zero.config.ts:4:",
    );
}

/// `db.globals.<key>` in compiled code: never-written defaults, then a typed JSON field round-trips.
#[test]
fn db_globals_read_defaults_and_write_typed_fields() {
    let tmp = std::env::temp_dir().join(format!("zero-db-globals-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/db-globals"), &tmp);
    let built = zero().arg("build").arg(&tmp).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let visit = || {
        let out = Command::new("php")
            .arg(tmp.join(".zero/app/zero/bin/zero.php"))
            .args(["action", "visit"])
            .output()
            .unwrap();
        serde_json::from_slice::<serde_json::Value>(&out.stdout).unwrap()
    };
    assert_eq!(visit(), serde_json::json!({ "data": ["Hi", null, 1] }));
    assert_eq!(visit(), serde_json::json!({ "data": ["Hi", { "visits": 1 }, 2] }));
    let _ = std::fs::remove_dir_all(tmp);
}

/// §1.6: access rules are compiled like hooks, but return a boolean or a filter on the collection.
#[test]
fn rejects_access_rules_that_cant_hold() {
    rejects(
        "reject-access-create-filter",
        "create rules return a boolean",
        "zero.config.ts:3:31",
    );
    rejects(
        "reject-access-query",
        "access rules can't query; put that in a hook",
        "zero.config.ts:3:41",
    );
    rejects(
        "reject-access-filter-column",
        "\"posts\" has no column or relation `ownr`",
        "zero.config.ts:3:39",
    );
}

struct Server {
    child: Child,
    port: u16,
    /// Bearer token sent with every request (writes default to `"editor"` access).
    token: Option<String>,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Server {
    fn start(app: &Path) -> Server {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let child = Command::new("php")
            .args(["-S", &format!("127.0.0.1:{port}"), "-t"])
            .arg(app.join("public"))
            .arg(app.join("public/index.php"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("php -S");
        let deadline = Instant::now() + Duration::from_secs(10);
        while TcpStream::connect(("127.0.0.1", port)).is_err() {
            assert!(Instant::now() < deadline, "php -S didn't start");
            std::thread::yield_now();
        }
        Server {
            child,
            port,
            token: None,
        }
    }

    /// Returns (status, body).
    fn send(&self, method: &str, path: &str, body: Option<&str>) -> (u16, serde_json::Value) {
        let mut s = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        let body = body.unwrap_or("");
        // One write: php -S rejects requests whose head arrives in pieces.
        let auth = self
            .token
            .as_ref()
            .map(|t| format!("Authorization: Bearer {t}\r\n"))
            .unwrap_or_default();
        let request = format!(
            "{method} {path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n{auth}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        s.write_all(request.as_bytes()).unwrap();
        let mut raw = String::new();
        s.read_to_string(&mut raw).unwrap();
        let status: u16 = raw
            .get(9..12)
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| panic!("bad response to {method} {path}: {raw:?}"));
        let json = raw.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");
        (status, serde_json::from_str(json).unwrap_or(serde_json::Value::Null))
    }
}

#[test]
fn pantry_example_builds_and_its_hooks_run_in_php() {
    let tmp = std::env::temp_dir().join(format!("zero-pantry-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let project = tmp.join("pantry");
    copy(&root().join("examples/pantry"), &project);
    let _ = std::fs::remove_dir_all(project.join(".zero"));
    let _ = std::fs::remove_dir_all(project.join("zero"));

    let out = zero().arg("build").arg(&project).output().unwrap();
    assert!(
        out.status.success(),
        "build failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    // Both dialects get a migration from the shared snapshot; MySQL only for editor:false tables.
    assert!(project.join("zero/migrations/sqlite/0001_init.sql").is_file());
    let wp = std::fs::read_to_string(project.join("zero/migrations/wp/0001_init.sql")).unwrap();
    assert!(wp.contains("CREATE TABLE `{prefix}zero_items`"), "{wp}");
    // A second build with no changes adds no migration.
    let again = zero().arg("build").arg(&project).output().unwrap();
    assert!(again.status.success());
    assert!(!project.join("zero/migrations/sqlite/0002_update.sql").exists());
    assert!(!project.join("zero/migrations/wp/0002_update.sql").exists());

    // Writes default to editor access: mint a token through the `zero users|tokens` passthrough.
    let cli = |args: &[&str]| {
        let out = zero().args(args).arg("--dir").arg(&project).output().unwrap();
        assert!(
            out.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice::<serde_json::Value>(&out.stdout).unwrap()
    };
    cli(&["users", "add", "kim", "--role", "editor"]);
    let token = cli(&["tokens", "create", "kim"])["data"]["token"]
        .as_str()
        .unwrap()
        .to_string();

    let app = project.join(".zero/app");
    let mut server = Server::start(&app);
    let (s, denied) = server.send("POST", "/api/locations", Some(r#"{"name":"Shed"}"#));
    assert_eq!((s, denied["code"].as_str()), (401, Some("unauthenticated")));
    server.token = Some(token);

    let (s, loc) = server.send("POST", "/api/locations", Some(r#"{"name":"Fridge","kind":"fridge"}"#));
    assert_eq!(s, 201, "{loc}");
    let loc_id = loc["data"]["id"].as_i64().unwrap();

    // beforeCreate trims, slugifies, and lowercases tags; afterCreate leaves well-stocked items alone.
    let (s, milk) = server.send(
        "POST",
        "/api/items",
        Some(&format!(r#"{{"name":"  Oat Milk ","quantity":2,"unit":"l","locationId":{loc_id},"expiresOn":"2000-01-01","tags":["Dairy-Free"]}}"#)),
    );
    assert_eq!(s, 201, "{milk}");
    assert_eq!(milk["data"]["name"], "Oat Milk");
    assert_eq!(milk["data"]["slug"], "oat-milk");
    assert_eq!(milk["data"]["tags"], serde_json::json!(["dairy-free"]));
    let (_, list) = server.send("GET", "/api/shopping_list", None);
    assert_eq!(list["data"].as_array().unwrap().len(), 0);

    // The consume action runs the update pipeline; afterUpdate restocks at the threshold.
    let milk_id = milk["data"]["id"].as_i64().unwrap();
    let (s, consumed) = server.send(
        "POST",
        "/api/actions/consume",
        Some(&format!(r#"{{"itemId":{milk_id}}}"#)),
    );
    assert_eq!(s, 200, "{consumed}");
    assert_eq!(consumed["data"]["message"], "Oat Milk: 1 l left");
    let (_, list) = server.send("GET", "/api/shopping_list?with=item", None);
    assert_eq!(list["data"][0]["name"], "Oat Milk");
    assert_eq!(list["data"][0]["item"]["quantity"], 1);

    // The hook's own validation and the runtime's coercion both surface as problems.
    let (s, blank) = server.send("POST", "/api/items", Some(r#"{"name":"   "}"#));
    assert_eq!((s, blank["detail"].as_str()), (422, Some("name can't be empty")));
    let (s, bad) = server.send("POST", "/api/actions/consume", Some(r#"{"itemId":999}"#));
    assert_eq!(
        (s, bad["code"].as_str(), bad["detail"].as_str()),
        (404, Some("not_found"), Some("No item 999"))
    );

    // A relation loaded inside an action, with a date computed in PHP.
    let (s, soon) = server.send("POST", "/api/actions/expiringSoon", Some("{}"));
    assert_eq!(s, 200, "{soon}");
    assert_eq!(
        soon["data"],
        serde_json::json!([{ "name": "Oat Milk", "expiresOn": "2000-01-01", "where": "Fridge" }])
    );

    drop(server);
    let _ = std::fs::remove_dir_all(&tmp);
}

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// Every action, access rule, and validator in tests/differential/cases.ts runs under
/// Node and as compiled PHP; the results must be identical. This is what "supported" means.
#[test]
fn compiled_php_matches_node_on_every_differential_case() {
    let dir = root().join("tests/differential");
    let node = Command::new("node")
        .arg(dir.join("run-node.mjs"))
        .arg(dir.join("cases.ts"))
        .output();
    let Ok(node) = node else {
        panic!("node is required for differential tests");
    };
    assert!(
        node.status.success(),
        "node failed:\n{}",
        String::from_utf8_lossy(&node.stderr)
    );
    let expected: serde_json::Value = serde_json::from_slice(&node.stdout).unwrap();
    // The fake ctxs/values Node used, read from the same config (see run-node.mjs).
    let fixtures = Command::new("node")
        .args(["--input-type=module", "-e"])
        .arg(format!(
            "import {{ register }} from 'node:module'; register({:?}); const m = await import({:?}); process.stdout.write(JSON.stringify({{ ctxs: m.ACCESS_CTXS, fctxs: m.FIELD_CTXS ?? [], values: m.VALIDATE_VALUES, vctx: m.VALIDATE_CTX }}));",
            format!("file://{}", dir.join("resolve-zero.mjs").display()),
            format!("file://{}", dir.join("cases.ts").display()),
        ))
        .output()
        .unwrap();
    assert!(
        fixtures.status.success(),
        "{}",
        String::from_utf8_lossy(&fixtures.stderr)
    );
    let fixtures: serde_json::Value = serde_json::from_slice(&fixtures.stdout).unwrap();

    let tmp = std::env::temp_dir().join(format!("zero-diff-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::copy(dir.join("cases.ts"), tmp.join("zero.config.ts")).unwrap();
    let built = zero().arg("build").arg(&tmp).output().unwrap();
    assert!(
        built.status.success(),
        "build failed:\n{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let app = tmp.join(".zero/app");

    let mut mismatches = Vec::new();
    for (name, want) in expected.as_object().unwrap() {
        let parts: Vec<&str> = name.split(':').collect();
        let out = match parts.as_slice() {
            ["access", _, _, i] => {
                let ctx = &fixtures["ctxs"][i.parse::<usize>().unwrap()];
                php_case(&app, name, serde_json::json!({ "ctx": ctx }))
            }
            ["field", _, _, _, i] => {
                let ctx = &fixtures["fctxs"][i.parse::<usize>().unwrap()];
                php_case(&app, name, serde_json::json!({ "ctx": ctx }))
            }
            ["validate", c, col, i] => {
                let value = &fixtures["values"][format!("{c}.{col}")][i.parse::<usize>().unwrap()];
                php_case(
                    &app,
                    name,
                    serde_json::json!({ "value": value, "ctx": fixtures["vctx"] }),
                )
            }
            _ => Command::new("php")
                .arg(app.join("zero/bin/zero.php"))
                .args(["action", name])
                .output()
                .unwrap(),
        };
        let got: serde_json::Value = serde_json::from_slice(&out.stdout)
            .unwrap_or_else(|_| serde_json::json!({ "raw": String::from_utf8_lossy(&out.stdout) }));
        let got = match got.get("error") {
            Some(e) if e.is_object() => serde_json::json!({ "error": e["detail"] }),
            _ => got,
        };
        if &got != want {
            mismatches.push(format!("{name}\n  node: {want}\n  php:  {got}"));
        }
    }
    let _ = std::fs::remove_dir_all(&tmp);
    assert!(
        mismatches.is_empty(),
        "compiled PHP disagrees with Node:\n{}",
        mismatches.join("\n")
    );
}

fn php_case(app: &Path, case: &str, args: serde_json::Value) -> std::process::Output {
    Command::new("php")
        .arg(root().join("tests/differential/run-php.php"))
        .arg(app)
        .arg(case)
        .arg(args.to_string())
        .output()
        .unwrap()
}

/// §9.1 golden: `zero build examples/blog` emits a schema.php equal, as data, to the frozen
/// fixture the runtime and the WP stores code against; `--target wp` emits the §4.9 plugin.
#[test]
fn blog_example_matches_the_frozen_schema_and_builds_the_plugin() {
    let example = root().join("examples/blog");
    assert!(
        example.join("zero.config.ts").is_file(),
        "examples/blog/zero.config.ts is missing (owner T writes it, design §1.9)"
    );
    let tmp = std::env::temp_dir().join(format!("zero-blog-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let project = tmp.join("blog");
    copy(&example, &project);
    for generated in [".zero", "zero"] {
        let _ = std::fs::remove_dir_all(project.join(generated));
    }
    let as_json = |php_file: &Path| -> serde_json::Value {
        let out = Command::new("php")
            .args(["-r", "echo json_encode(require $argv[1]);"])
            .arg(php_file)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        serde_json::from_slice(&out.stdout).unwrap()
    };

    let out = zero()
        .args(["build", "--target", "standalone"])
        .arg(&project)
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(
        as_json(&project.join(".zero/app/zero/app/schema.php")),
        as_json(&root().join("tests/fixtures/blog/schema.php")),
        "schema.php drifted from tests/fixtures/blog/schema.php"
    );
    // §3.5.1: post-backed columns that only postmeta can filter get a one-line hint.
    assert!(
        String::from_utf8_lossy(&out.stderr).contains(
            "hint: \"posts.authorId\" is filtered through postmeta on WordPress; set editor: false on \"posts\" if this list grows large"
        ),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let out = zero().args(["build", "--target", "wp"]).arg(&project).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let plugin = project.join(".zero/wp-content/plugins/zero-app-blog");
    for rel in [
        "zero-app-blog.php",
        "zero/app/functions.php",
        "zero/app/migrations/0001_init.sql",
    ] {
        assert!(plugin.join(rel).exists(), "plugin is missing {rel}");
    }
    assert!(project.join(".zero/wp-content/plugins/zero-app-blog.zip").is_file());
    let content = project.join(".zero/wp-content");
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(content.join("zero-manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["runtime"], "0.2");
    assert_eq!(manifest["app"], "blog");
    for slug in ["zero-runtime", "zero-identity", "zero-app-blog"] {
        let archive = std::fs::File::open(content.join("plugins").join(format!("{slug}.zip"))).unwrap();
        let mut archive = zip::ZipArchive::new(archive).unwrap();
        assert!(archive.by_name(&format!("{slug}/{slug}.php")).is_ok());
    }
    assert!(content.join("plugins/zero-runtime/zero/bootstrap.php").is_file());
    let doctor = zero()
        .args(["doctor", "--json", "--wp"])
        .arg(&project)
        .output()
        .unwrap();
    assert!(doctor.status.success(), "{}", String::from_utf8_lossy(&doctor.stdout));
    let doctor: serde_json::Value = serde_json::from_slice(&doctor.stdout).unwrap();
    let platform: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("tests/fixtures/platform.json")).unwrap()).unwrap();
    assert_eq!(doctor["data"]["requirements"], platform);

    let standalone = project.join(".zero/app");
    let diagnose_standalone = |database: Option<&Path>| {
        let mut command = zero();
        command
            .args(["doctor", "--target", "standalone", "--json"])
            .arg(&project)
            .env_remove("ZERO_DB_PATH");
        if let Some(database) = database {
            command.env("ZERO_DB_PATH", database);
        }
        let output = command.output().unwrap();
        let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        (output.status.code(), report)
    };
    // An explicit target must diagnose that artifact even when the other target exists.
    let saved_standalone = tmp.join("standalone");
    std::fs::rename(&standalone, &saved_standalone).unwrap();
    let (code, report) = diagnose_standalone(None);
    assert_eq!(code, Some(1), "{report}");
    assert!(
        report["data"]["checks"].as_array().unwrap().iter().any(|check| {
            check["name"] == "built runtime series" && check["ok"] == false && check["detail"] == "missing"
        }),
        "{report}"
    );
    std::fs::rename(&saved_standalone, &standalone).unwrap();

    let migrate = |database: Option<&Path>| {
        let mut command = Command::new("php");
        command
            .arg(standalone.join("zero/bin/zero.php"))
            .arg("migrate")
            .env_remove("ZERO_DB_PATH");
        if let Some(database) = database {
            command.env("ZERO_DB_PATH", database);
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    let external = tmp.join("external.sqlite");
    migrate(Some(&external));
    let (code, report) = diagnose_standalone(Some(&external));
    assert_eq!(code, Some(0), "{report}");
    migrate(None);
    // A migrated default database must not conceal an unmigrated configured database.
    let (code, report) = diagnose_standalone(Some(&tmp.join("unmigrated.sqlite")));
    assert_eq!(code, Some(1), "{report}");
    assert!(
        report["data"]["checks"].as_array().unwrap().iter().any(|check| {
            check["name"] == "pending migrations"
                && check["ok"] == false
                && check["detail"].as_str().unwrap().starts_with("1;")
        }),
        "{report}"
    );

    let mut wp_schema = as_json(&plugin.join("zero/app/schema.php"));
    assert_eq!(wp_schema["target"], "wp");
    wp_schema["target"] = "standalone".into();
    assert_eq!(wp_schema, as_json(&root().join("tests/fixtures/blog/schema.php")));
    // Post-backed collections have no MySQL table; editor:false ones do (no FK to a post type).
    let mysql = std::fs::read_to_string(plugin.join("zero/app/migrations/0001_init.sql")).unwrap();
    assert!(mysql.contains("CREATE TABLE `{prefix}zero_comments`"), "{mysql}");
    assert!(
        !mysql.contains("zero_posts`") && !mysql.contains("FOREIGN KEY"),
        "{mysql}"
    );
    // The typed client: generated types and the descriptor, next to the migrations.
    let types = std::fs::read_to_string(project.join("zero/client/types.ts")).unwrap();
    assert!(
        types.contains("tags: (\"news\" | \"guide\" | \"release\")[];"),
        "{types}"
    );
    assert!(project.join("zero/client/schema.ts").is_file());
    let _ = std::fs::remove_dir_all(&tmp);
}

/// The generated client types private files and media updates, and keeps the built-in `PrivateFile`
/// distinct from a collection whose type name would collide with it (phase-2 §7.2).
#[test]
fn generated_client_types_files_and_avoids_the_private_file_name() {
    let tmp = std::env::temp_dir().join(format!("zero-private-files-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/private-files"), &tmp);
    let out = zero().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let out = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .args([
            "--strict",
            "--noEmit",
            "--target",
            "ES2022",
            "--module",
            "ESNext",
            "--moduleResolution",
            "bundler",
            "--allowImportingTsExtensions",
            "--lib",
            "ES2022,DOM",
        ])
        .arg(tmp.join("client.ts"))
        .output()
        .expect("tsc (or TSC) must be installed to check generated clients");
    assert!(
        out.status.success(),
        "generated client failed: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let _ = std::fs::remove_dir_all(&tmp);
}

/// Every static phase-2 rejection is target-independent (phase-2 §§4–7).
#[test]
fn rejects_phase2_static_contracts() {
    let cases = [
        ("reject-showif-dynamic", "showIf must be static data"),
        ("reject-sync-symlink", "sync directory must stay inside the project"),
        ("reject-field-access-id", "access/showIf is not allowed on id()"),
        ("reject-field-access-title", "title is always readable"),
        ("reject-field-access-filter", "field rules here return a boolean"),
        ("reject-field-access-query", "access rules can't query"),
        ("reject-field-access-async", "field rules must be synchronous"),
        ("reject-field-access-helper", "access rules can't query"),
        (
            "reject-field-access-fallthrough",
            "field rules must return a boolean on every path",
        ),
        (
            "reject-field-access-bare-return",
            "field rules must return a boolean on every path",
        ),
        (
            "reject-field-access-helper-fallthrough",
            "access rules return true, false, or a filter",
        ),
        (
            "reject-field-access-catch-fallthrough",
            "field rules must return a boolean on every path",
        ),
        ("reject-field-access-self", "self is only allowed on auth collection"),
        (
            "reject-field-access-global",
            "field access applies to collection columns",
        ),
        ("reject-showif-sibling", "showIf names non-sibling"),
        ("reject-showif-operator", "invalid showIf operator"),
        (
            "reject-showif-boolean-null",
            "which is never empty; compare it with true or false",
        ),
        ("reject-showif-empty-in", "invalid showIf operator or operand \"in\""),
        (
            "reject-showif-nested-date",
            "the editor can't compare the value of \"due\"",
        ),
        ("reject-showif-structured", "compare a scalar sibling"),
        ("reject-showif-nested-sibling", "showIf names non-sibling"),
        ("reject-showif-title", "title is always readable"),
        ("reject-sync-auth", "auth collections cannot sync"),
        ("reject-sync-directory", "two collections sync into the same directory"),
        ("reject-sync-outside", "sync directory must stay inside the project"),
        ("reject-sync-content", "Markdown sync needs a content designation"),
        ("reject-sync-uid", "uid: false cannot be combined with sync"),
        (
            "reject-sync-primary-key",
            "syncs with files, so its primary key must be id()",
        ),
        ("reject-sync-reference", "sync references need uid: true on a"),
        (
            "reject-job-reference",
            "`.references()` isn't allowed on an action input",
        ),
        ("reject-job-unique", "`.unique()` isn't allowed on an action input"),
        ("reject-job-retries", "job retries must be a whole number from 0 to 20"),
        ("reject-once-key", "once key must be a string"),
        ("reject-env-placement", "env() is only allowed in webhooks/signature"),
        ("reject-env-coercion", "env() is only allowed in webhooks/signature"),
        (
            "reject-env-serialization",
            "env() is only allowed in webhooks/signature",
        ),
        ("reject-env-condition", "env() is only allowed in webhooks/signature"),
        ("reject-env-binary", "env() is only allowed in webhooks/signature"),
        ("reject-env-predicate", "env() is only allowed in webhooks/signature"),
        ("reject-env-hasown", "env() is only allowed in webhooks/signature"),
        ("reject-signature-access", "signature cannot be combined with access"),
        ("reject-webhook-collection", "webhook event names an unknown collection"),
        ("reject-enqueue-unknown-job", "unknown job `send`"),
        (
            "reject-env-captured",
            "env() values can't be stored inside captured data",
        ),
        // TEMPORARY (src/unlanded.rs): a lane deletes its row when its feature lands.
        ("reject-unlanded-auth", "not implemented until lane E"),
        ("reject-auth-duplicate", "at most one auth: true collection"),
        (
            "reject-auth-email",
            "auth: true needs email: email().notNull().unique()",
        ),
        ("reject-auth-editor", "auth: true requires editor: false"),
        ("reject-auth-drafts", "auth: true requires drafts: false"),
        ("reject-auth-revisions", "auth: true requires revisions: false"),
        (
            "reject-auth-slug",
            "auth collections cannot have slug() or localized fields",
        ),
        ("reject-auth-self", "self is only allowed on auth collection"),
        ("reject-auth-create-self", "self is only allowed on auth collection"),
        (
            "reject-auth-reserved-password",
            "password is reserved on auth collections",
        ),
        ("reject-auth-reserved-role", "role is reserved on auth collections"),
        (
            "reject-auth-reserved-passwordHash",
            "passwordHash is reserved on auth collections",
        ),
        ("reject-agents-kebab", "ability kebab collision: notes-list"),
        ("reject-agents-media", "media has no option `agents`"),
        ("reject-files-cover", "fit: cover requires height"),
        ("reject-files-size-name", "invalid media size name"),
        ("reject-files-size-count", "media supports at most 12 sizes"),
        ("reject-files-bucket", "unknown file bucket"),
        (
            "reject-files-global",
            "file() columns belong to collections, not globals",
        ),
        ("reject-files-owner", "owner is only allowed in files access"),
        ("reject-files-accept", "accept entries must be type/subtype or type/*"),
        (
            "reject-files-media",
            "file bucket name must match its key and cannot be media",
        ),
        ("reject-localized-kind", "translate text, not values"),
        ("reject-localized-missing", ".localized() requires locales"),
        ("reject-localized-default", "locales.default must appear in all"),
        ("reject-localized-tag", "invalid or duplicate locale"),
        ("reject-localized-unique", "unique is not allowed on a localized column"),
        (
            "reject-localized-auth",
            "auth collections cannot have slug() or localized fields",
        ),
        (
            "reject-localized-reserved-locale",
            "locale is reserved for localization",
        ),
        (
            "reject-localized-reserved-translations",
            "translations is reserved for localization",
        ),
        (
            "reject-localized-reserved-translationOf",
            "translationOf is reserved for localization",
        ),
        (
            "reject-localized-reserved-translationGroup",
            "translationGroup is reserved for localization",
        ),
    ];
    for (fixture, message) in cases {
        for target in ["standalone", "wp"] {
            let out = zero()
                .args(["check", "--target", target])
                .arg(root().join("tests/fixtures").join(fixture))
                .output()
                .unwrap();
            let stderr = String::from_utf8_lossy(&out.stderr);
            assert_eq!(out.status.code(), Some(1), "{fixture} ({target}): {stderr}");
            assert!(
                stderr.contains(message),
                "{fixture} ({target}): expected {message:?}, got {stderr}"
            );
            assert!(
                stderr.contains("--> zero.config.ts:"),
                "{fixture} has no source location: {stderr}"
            );
            assert!(stderr.contains("help:"), "{fixture} has no fix: {stderr}");
        }
    }
    // Mutations must not make a partial field predicate look exhaustive.
    let tmp = std::env::temp_dir().join(format!("zero-phase2-mutations-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    for (body, diagnostic) in [
        (
            "const make = (value: number[]) => { value.push(1); return () => value.length; }; make([]); return true;",
            "a captured mutating parameter needs an object with required fields",
        ),
        (
            "for (const values of [[1]]) values.push(2); return true;",
            "a mutating loop binding needs an object with required fields",
        ),
        (
            "for (const { items } of [{ items: [1] }]) items.push(2); return true;",
            "through a destructured loop binding",
        ),
        (
            "[1].map((value: 1) => value); return true;",
            "this parameter is declared as 1, but it receives",
        ),
        (
            "const read = (value: 1) => value; [1, 2].map(read); return true;",
            "this parameter is declared as 1, but it receives",
        ),
        (
            "const read = (value: number, index: number, extra: number) => value; [1].map(read); return true;",
            "this parameter is declared as number, but it receives null",
        ),
        (
            "'a'.replace('a', (match: string, offset: 'zero') => offset); return true;",
            "this parameter is declared as",
        ),
        (
            "const read = ({ flag }: { flag: boolean } = { flag: 'bad' }) => flag; return read();",
            "this default is",
        ),
        (
            "function first(pair: ['a', 'b']) { return pair[0]; } const pair: ['a', 'b'] = ['a', 'b']; pair.shift(); switch (first(pair)) { case 'a': return true; case null: return false; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const pair: ['a', 'b'] = ['a', 'b']; pair.shift(); switch (pair[0]) { case 'a': return true; case null: return false; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const read = (flag?: boolean) => { switch (flag) { case true: case false: return true; } }; return read();",
            "access rules return true, false, or a filter",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; const make = () => { if (value === null) throw new Error('missing'); return () => value; }; const read = make(); value = null; if (ctx.user !== null) make(); switch (read()) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const values: ('a' | 'b')[] = []; switch (values[0]) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const values: true[] = []; const value = (values[0] &&= true); switch (value) { case true: return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const values: ['a', 'b'] = ['a', 'b']; values.pop(); switch (values[1]) { case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const values: ('a' | 'b')[] = []; const [value] = values; switch (value) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "function accept(value: 'a' | 'b') { switch (value) { case 'a': case 'b': return true; } } const values: ('a' | 'b')[] = []; return accept(values[0]);",
            "function expects",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; if (value === null) return false; const read = () => value; const invoke = () => read(); value = null; switch (invoke()) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; const clear = () => { value = null; return true; }; if (value !== null && clear()) { switch (value) { case 'a': case 'b': return true; } } else { return false; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; if (value === null) return false; let i = 0; while (true) { if (i === 1) { switch (value) { case 'a': case 'b': return true; } break; } value = null; i++; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const a = { inner: { count: 0 } }; const mutate = ({ inner }: { inner: { count: number } }) => { inner.count++; }; mutate(a); return true;",
            "through a destructured parameter",
        ),
        (
            "let a = { count: 0 }; const mutate = (v: { count: number }, extra: number[]) => { v.count++; }; const reset = () => { a = { count: 9 }; return []; }; mutate(a, reset()); return true;",
            "a later argument replaces an object or array",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; if (value === null) return false; const read = () => value; value = null; switch (read()) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; if (value === null) return false; value = null; switch (value) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const record: { inner: { count: number } | null } = { inner: { count: 0 } }; if (record.inner !== null) { record.inner = null; record.inner.count = 1; } return true;",
            "object might be null",
        ),
        (
            "const record: { inner: { count: number } | null } = { inner: { count: 0 } }; function clear(value: { inner: { count: number } | null }) { value.inner = null; } if (record.inner !== null) { clear(record); record.inner.count = 1; } return true;",
            "object might be null",
        ),
        (
            "const a = { count: 0 }; const reset = (v: { count: number }) => { if (v.count < 0) v.count++; v = { count: 9 }; }; reset(a); return true;",
            "this parameter also shares member mutations",
        ),
        (
            "let value: 0 | 1 = 1; const read = () => value; value++; switch (read()) { case 0: case 1: return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 0 | 1 = 1; while (true) { if (value > 1) { switch (value) { case 0: case 1: return true; } break; } value++; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let record: { count: 0 | 1 } = { count: 1 }; function bump(value: { count: 0 | 1 }) { value.count++; } bump(record); switch (record.count) { case 0: case 1: return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 0 | 1 = 1; value++; function accept(n: 0 | 1) { switch (n) { case 0: case 1: return true; } } return accept(value);",
            "access rules return true, false, or a filter",
        ),
        (
            "let record: { count: 0 | 1 } = { count: 1 }; record.count++; function accept(n: { count: 0 | 1 }) { switch (n.count) { case 0: case 1: return true; } } return accept(record);",
            "access rules return true, false, or a filter",
        ),
        (
            "let record: { count: 0 | 1 } = { count: 1 }; record.count++; function accept({ count }: { count: 0 | 1 }) { switch (count) { case 0: case 1: return true; } } return accept(record);",
            "access rules return true, false, or a filter",
        ),
        (
            "let value: 0 | 1 = 1; value++; const out = (value ??= 1); switch (out) { case 0: case 1: return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 0 | 1 = 1; value++; const out = (value ||= 1); switch (out) { case 0: case 1: return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "function run(value: 0 | 1, write: (() => void) | null = () => { value++; }) { if (write !== null) write(); switch (value) { case 0: case 1: return true; } } return run(1);",
            "access rules return true, false, or a filter",
        ),
        (
            "let record: { count: 0 | 1 } | null = { count: 0 }; if (record !== null) record.count = 2; return true;",
            "can't assign",
        ),
        (
            "let record: { count: number } | null = null; record.count = 1; return true;",
            "object might be null",
        ),
        ("let value: true = true; value &&= false; return true;", "can't assign"),
        ("let value: false = false; value ||= true; return true;", "can't assign"),
        ("let value: null = null; value ??= false; return true;", "can't assign"),
        (
            "const values: true[] = [true]; values.fill(false); return true;",
            "can't insert",
        ),
        (
            "const values: (0 | 1)[] = [1]; values.unshift(2); return true;",
            "can't insert",
        ),
        (
            "const values: (0 | 1)[] = [1]; values.splice(0, 1, 2); return true;",
            "can't insert",
        ),
        (
            "let values: (0 | 1)[] = [1]; values[0]!++; values.push(2); return true;",
            "can't insert",
        ),
        (
            "function bump(value: { count: 0 | 1 }) { value.count++; } bump({ count: 2 }); return true;",
            "function expects",
        ),
        ("let value: 0 | 1 = 1; value++; value = 2; return true;", "can't assign"),
        (
            "function accept(value: { count: 0 | 1 }) { return true; } const map: Record<string, { count: 0 | 1 }> = {}; return accept(map['missing']);",
            "function expects",
        ),
    ] {
        std::fs::write(tmp.join("zero.config.ts"), format!(
            "import {{ collection, id, text, defineConfig }} from 'zero'; const notes = collection('notes', {{ id: id(), secret: text().access({{ read: (ctx): boolean => {{ {body} }} }}) }}, {{ editor: false }}); export default defineConfig({{ schema: {{ notes }} }});"
        )).unwrap();
        for target in ["standalone", "wp"] {
            let out = zero().args(["check", "--target", target]).arg(&tmp).output().unwrap();
            let stderr = String::from_utf8_lossy(&out.stderr);
            assert_eq!(out.status.code(), Some(1), "{target}: {stderr}");
            assert!(stderr.contains(diagnostic), "{target}: {stderr}");
        }
    }
    for invocation in [
        "[1, 2].reduce((acc, item) => { value++; return acc; }, 0)",
        "[1, 2].flatMap(item => { value++; return [item]; })",
        "[1, 2].findLast(item => { value++; return false; })",
        "[1, 2].findLastIndex(item => { value++; return false; })",
        "[2, 1].sort((a, b) => { value += 2; return a - b; })",
        "[2, 1].toSorted((a, b) => { value += 2; return a - b; })",
        "Array.from({ length: 2 }, () => { value++; return 1; })",
        "const items = [1, 2]; Array.from(items, item => { value++; return item; })",
        "'aa'.replace(/a/g, () => { value++; return 'b'; })",
        "'aa'.replaceAll('a', () => { value++; return 'b'; })",
    ] {
        std::fs::write(tmp.join("zero.config.ts"), format!(
            "import {{ collection, id, text, defineConfig }} from 'zero'; const notes = collection('notes', {{ id: id(), secret: text().access({{ read: (): boolean => {{ let value: 0 | 1 = 0; {invocation}; switch (value) {{ case 0: case 1: return true; }} }} }}) }}, {{ editor: false }}); export default defineConfig({{ schema: {{ notes }} }});"
        )).unwrap();
        for target in ["standalone", "wp"] {
            let out = zero().args(["check", "--target", target]).arg(&tmp).output().unwrap();
            let stderr = String::from_utf8_lossy(&out.stderr);
            assert_eq!(out.status.code(), Some(1), "{invocation} ({target}): {stderr}");
            assert!(
                stderr.contains("field rules must return a boolean on every path"),
                "{invocation} ({target}): {stderr}"
            );
        }
    }
    for extraction in [
        "const write = writers.at(0)!; write()",
        "writers.slice()[0]!()",
        "writers.concat(writers)[0]!()",
        "writers.reverse()[0]!()",
        "writers.toReversed()[0]!()",
        "writers.pop()!()",
        "writers.shift()!()",
        "writers.splice(0, 1)[0]!()",
        "const nested = [writers]; nested.flat()[0]!()",
        "Object.values({ write: writers[0]! })[0]!()",
        "Object.entries({ write: writers[0]! })[0]![1]!()",
        "const entries: [string, () => void][] = [['write', writers[0]!]]; Object.fromEntries(entries)['write']!()",
        "Array.from(writers)[0]!()",
        "const objects = [{ write: writers[0]! }]; objects.forEach(({ write }) => write())",
    ] {
        std::fs::write(tmp.join("zero.config.ts"), format!(
            "import {{ collection, id, text, defineConfig }} from 'zero'; const notes = collection('notes', {{ id: id(), secret: text().access({{ read: (): boolean => {{ let value: 0 | 1 = 1; const writers = [() => {{ value++; }}]; {extraction}; switch (value) {{ case 0: case 1: return true; }} }} }}) }}, {{ editor: false }}); export default defineConfig({{ schema: {{ notes }} }});"
        )).unwrap();
        for target in ["standalone", "wp"] {
            let out = zero().args(["check", "--target", target]).arg(&tmp).output().unwrap();
            let stderr = String::from_utf8_lossy(&out.stderr);
            assert_eq!(out.status.code(), Some(1), "{extraction} ({target}): {stderr}");
            assert!(
                stderr.contains("field rules must return a boolean on every path"),
                "{extraction} ({target}): {stderr}"
            );
        }
    }
    let _ = std::fs::remove_dir_all(tmp);
}

/// The v3 config normalizes to one shape, and the new slots run through the existing PHP path.
#[test]
fn phase2_schema_and_closures_match_the_contract() {
    let tmp = std::env::temp_dir().join(format!("zero-phase2-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::copy(
        root().join("tests/fixtures/phase2-surface/zero.config.ts"),
        tmp.join("zero.config.ts"),
    )
    .unwrap();
    std::fs::copy(
        root().join("tests/fixtures/phase2-surface/client.ts"),
        tmp.join("client.ts"),
    )
    .unwrap();
    let golden: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("tests/fixtures/phase2.schema.json")).unwrap()).unwrap();
    let mut snapshots = Vec::new();
    for target in ["standalone", "wp"] {
        // The v3 golden renders every key, including features no runtime enforces yet (src/unlanded.rs).
        let out = zero()
            .env("ZERO_ALLOW_UNLANDED_FEATURES", "1")
            .args(["build", "--target", target])
            .arg(&tmp)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        let schema_file = if target == "wp" {
            tmp.join(".zero/wp-content/plugins/zero-app-phase2/zero/app/schema.php")
        } else {
            tmp.join(".zero/app/zero/app/schema.php")
        };
        let out = Command::new("php")
            .args(["-r", "echo json_encode(require $argv[1]);"])
            .arg(schema_file)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        let actual: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        let mut expected = golden.clone();
        expected["target"] = target.into();
        if target == "wp" {
            expected["collections"]["posts"]["columns"]
                .as_object_mut()
                .unwrap()
                .remove("translationGroup");
        }
        assert_eq!(actual, expected, "v3 metadata ({target}) drifted");
        snapshots.push(std::fs::read_to_string(tmp.join("zero/migrations/snapshot.json")).unwrap());
    }
    // §7.3: the migration snapshot is shared by both targets, so switching targets must plan no
    // migration (a WP build must not drop the SQLite translation-group column).
    assert_eq!(
        snapshots[0], snapshots[1],
        "the migration snapshot depends on the build target"
    );
    assert!(
        !tmp.join("zero/migrations/sqlite/0002_update.sql").exists(),
        "switching targets planned a SQLite migration"
    );
    // §7.3 drift guard: the generated wpml-config.xml (copy synced metas, translate localized ones).
    let wpml = tmp.join(".zero/wp-content/plugins/zero-app-phase2/wpml-config.xml");
    assert_eq!(
        std::fs::read_to_string(&wpml).expect("localized post types ship wpml-config.xml"),
        std::fs::read_to_string(root().join("tests/fixtures/phase2.wpml-config.xml")).unwrap(),
        "wpml-config.xml drifted"
    );
    let out = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .args([
            "--strict",
            "--noEmit",
            "--target",
            "ES2022",
            "--module",
            "ESNext",
            "--moduleResolution",
            "bundler",
            "--allowImportingTsExtensions",
            "--lib",
            "ES2022,DOM",
        ])
        .arg(tmp.join("client.ts"))
        .output()
        .expect("tsc (or TSC) must be installed to check generated clients");
    assert!(
        out.status.success(),
        "generated client contract failed: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let app = tmp.join(".zero/app");
    let out = Command::new("php")
        .args([
            "-r",
            r#"
        require $argv[1] . '/zero/runtime/bootstrap.php';
        \Zero\App::boot($argv[1]);
        $db = \Zero\Db::instance();
        $schema = $db->schema();
        $col = $schema->collection('posts')['columns']['seo']['fields']['label'];
        $fn = '\\ZeroApp\\' . $col['access']['read']['fn'];
        $private = $fn(['data' => ['label' => 'private'], 'user' => null, 'target' => 'standalone', 'op' => 'read']);
        $public = $fn(['data' => ['label' => 'hello'], 'user' => null, 'target' => 'standalone', 'op' => 'read']);
        $authenticated = $fn(['data' => ['label' => 'hello'], 'user' => ['id' => 1, 'name' => 'Editor', 'role' => 'editor'], 'target' => 'standalone', 'op' => 'read']);
        $fieldThrows = false;
        try {
            $fn(['data' => ['label' => 'error'], 'user' => null, 'target' => 'standalone', 'op' => 'read']);
        } catch (\Zero\JsError $error) {
            $fieldThrows = $error->getMessage() === 'denied';
        }
        $action = $schema->action('inbound');
        $fn = '\\ZeroApp\\' . $action['handler'];
        $actor = ['user' => ['id' => 1, 'name' => 'Editor', 'role' => 'editor'], 'target' => 'standalone'];
        $actionAllowed = $fn(\Zero\Schema::validateInput($action['input'], []), $actor);
        $actionThrows = false;
        try {
            $fn(\Zero\Schema::validateInput($action['input'], ['allow' => false]), $actor);
        } catch (\Zero\JsError $error) {
            $actionThrows = $error->getMessage() === 'denied';
        }
        $fn = '\\ZeroApp\\' . $schema->action('widened')['handler'];
        $widened = $fn([]);
        // Ordinary array mutation/reduction results belong to the differential
        // owner; this fixture retains their generated-client type proof.
        unset($widened['values'], $widened['choice'], $widened['nested'], $widened['reduced'], $widened['reducedNested']);
        $nested = $schema->collection('posts')['columns']['sections']['layouts']['hero']['label'];
        $fn = '\\ZeroApp\\' . $nested['access']['update']['fn'];
        $update = $fn(['data' => [], 'op' => 'update'] + $actor);
        $wpUpdate = $fn(['data' => [], 'op' => 'update', 'target' => 'wp'] + $actor);
        $bucket = $schema->files()['decks'];
        $fn = '\\ZeroApp\\' . $bucket['access']['create']['fn'];
        $bucketGuest = $fn(['user' => null, 'target' => 'standalone', 'op' => 'create']);
        $job = $schema->jobs()['sendWelcome'];
        $input = \Zero\Schema::validateInput($job['input'], ['email' => 'a@example.com', 'payload' => ['message' => 'typed'], 'data' => ['payload' => ['suffix' => 'nested']]]);
        $ctx = ['user' => null, 'target' => 'standalone', 'attempt' => 2, 'jobId' => 'job-test'];
        $fn = '\\ZeroApp\\' . $job['handler'];
        $db->transaction(static fn () => $fn($input, $ctx));
        echo json_encode([$private, $public, $authenticated, $fieldThrows, $actionAllowed, $actionThrows, $widened, [$update, $wpUpdate], $bucketGuest, $db->findMany('audit')]);
    "#,
        ])
        .arg(&app)
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let result: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let nullable_arguments = serde_json::json!({"local": 1, "module": 2, "absent": null, "sibling": 3, "stable": "a", "unchecked": {"empty": null, "shortened": null, "tail": [null], "reversed": "b", "captured": "b", "forwarded": "b", "grown": "a", "optional": null, "present": true, "defaulted": true, "moduleDefaulted": true, "moduleProvided": false, "destructuredDefault": true, "destructuredProvided": false, "early": null, "late": "b"}, "ordered": 4, "looped": "b", "earlier": 0});
    assert_eq!(
        result,
        serde_json::json!([false, true, false, true, true, true, {"finite": ["a", "b"], "callbacks": [null], "tuples": ["aa"], "finiteDefaults": ["a", "b"], "defaultTuple": "aa", "numeric": {"value": 2, "count": 2, "item": 0, "keep": 0}, "effects": {"captured": 2, "invoked": 2, "loop": 2, "helper": {"count": 3, "captured": 3, "keep": 0}, "maybeCaptured": null, "maybeHelper": null, "shadow": 1, "early": 0, "byValue": 1, "passed": {"scalar": null, "member": null, "object": {"maybe": null, "keep": 0}, "destructured": {"maybe": null, "keep": 0}}, "callback": 2, "defaulted": 2, "localDefaulted": 2, "logical": {"nullish": 2, "or": 2, "and": 1, "guarded": 3, "absent": 0, "nested": 4}, "nullableArguments": nullable_arguments}, "formatted": "-1", "inferredNumber": "0", "functionMaybe": null, "defaultMaybe": null, "maybe": null}, [true, false], false, [{"id": 1, "note": "typed:job-test:2:nested"}]])
    );
    let _ = std::fs::remove_dir_all(tmp);
}

/// §6.1 on standalone, through the binary: a compiled hook enqueues a compiled job, and
/// `zero jobs work --once` / `zero jobs list` drive the PHP queue (its semantics live in tests/php/jobs_test.php).
#[test]
fn compiled_jobs_run_through_the_zero_jobs_cli() {
    let tmp = std::env::temp_dir().join(format!("zero-jobs-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/jobs"), &tmp);
    let out = zero().arg("build").arg(&tmp).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let php = |args: &[&str]| -> serde_json::Value {
        let out = Command::new("php")
            .arg(tmp.join(".zero/app/zero/bin/zero.php"))
            .args(args)
            .output()
            .unwrap();
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)))
    };
    let jobs = |args: &[&str]| -> serde_json::Value {
        let out = zero().arg("jobs").args(args).arg("--dir").arg(&tmp).output().unwrap();
        assert!(
            out.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&out.stdout)
        );
        serde_json::from_slice::<serde_json::Value>(&out.stdout).unwrap()["data"].clone()
    };
    php(&[
        "insert",
        "items",
        r#"[{"name":"Milk","quantity":1},{"name":"Eggs","quantity":9}]"#,
    ]);
    let queued = jobs(&["list", "--state", "pending"]);
    assert_eq!(queued.as_array().unwrap().len(), 1, "{queued}");
    assert_eq!(queued[0]["job"], "notifyLowStock");
    assert_eq!(queued[0]["key"], "low-1");
    assert_eq!(jobs(&["work", "--once"])["done"], 1);
    assert_eq!(
        php(&["find", "alerts"])["data"],
        serde_json::json!([{ "id": 1, "itemId": 1, "note": "Milk is low (attempt 1)" }])
    );
    assert_eq!(jobs(&["list", "--state", "done"]).as_array().unwrap().len(), 1);
    let _ = std::fs::remove_dir_all(&tmp);
}
