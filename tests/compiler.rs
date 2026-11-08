//! Runs the real `zero` binary. Rejections are checked by message and
//! location; the pantry example is built, served with `php -S`, and driven
//! over HTTP so hooks and actions are proven by their effects in PHP.

// Runs the `zero` binary: only with the cli feature (the browser build of the core has none).
#![cfg(feature = "cli")]

use std::io::{BufRead, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

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
        "abstract, ambient or generic classes",
        "zero.config.ts:2:1",
    );
    rejects(
        "reject-uninstalled-package",
        "can't import \"dayjs\": package is not installed in node_modules",
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
fn a_catch_all_route_segment_comes_last() {
    rejects(
        "reject-route-catchall-middle",
        "has a *catch-all that is not the last segment",
        "zero.config.ts:3:",
    );
    let out = zero()
        .args(["check"])
        .arg(root().join("tests/fixtures/route-catchall"))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn destructured_defaults_may_read_earlier_siblings_only() {
    let out = zero()
        .args(["check"])
        .arg(root().join("tests/fixtures/sibling-parameter-defaults"))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    rejects(
        "reject-later-sibling-default",
        "parameter defaults can't reference the current or a later parameter",
        "zero.config.ts:3:",
    );
}

#[test]
fn mail_send_needs_recipients_a_subject_and_a_body() {
    rejects(
        "reject-mail-message",
        "mail.send() needs { to, subject, text or html }",
        "zero.config.ts:3:",
    );
    let out = zero()
        .args(["check"])
        .arg(root().join("tests/fixtures/mail-import"))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
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
        "zero.config.ts:3:46",
    );
    // §1.2: modifiers per column kind, pointing at the modifier call.
    rejects(
        "reject-modifier-kind",
        "`.max()` isn't valid on a boolean column",
        "zero.config.ts:2:45",
    );
    // §1.3: sub-fields hold plain values.
    rejects(
        "reject-subfield-unique",
        "`.unique()` isn't allowed inside a group, repeater, or blocks field (`code`)",
        "zero.config.ts:2:66",
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
        "zero.config.ts:2:42",
    );
    rejects(
        "reject-drafts-reserved",
        "`status` is reserved: drafts add these",
        "zero.config.ts:2:71",
    );
    // §1.5
    rejects(
        "reject-global-required",
        "global fields that are notNull need a default (`title`)",
        "zero.config.ts:3:38",
    );
    // Literal defaults follow the strict ISO timestamp codec, inside structured columns too.
    rejects(
        "reject-default-timestamp",
        "`when` defaults to a `at` value that isn't a real ISO 8601 date or timestamp",
        "zero.config.ts:4:",
    );
    // Each case owns a separate registry invariant, exercised through the compiler.
    let tmp = tempfile::tempdir().unwrap();
    for (body, message) in [
        (
            "collections: { notes: table({ title: text().notNull() }) }",
            "table() belongs in `tables`",
        ),
        (
            "collections: { notes: collection({ title: text().notNull() }) }, tables: { notes: table({}) }",
            "share the physical name `notes`",
        ),
        (
            "collections: { stockItems: collection({ title: text().notNull() }) }, tables: { stock_items: table({}) }",
            "share the physical name `stock_items`",
        ),
        (
            "tables: { first: shared, second: shared }",
            "a definition can only be registered once",
        ),
        (
            "tables: { notes: table({}, { storageName: 'bad-name' }) }",
            "`storageName` must be an identifier",
        ),
        (
            "tables: { notes: table({}, { storageName: 'media' }) }",
            "\"media\" is reserved",
        ),
        (
            "tables: { media: table({}, { storageName: 'assets' }) }",
            "\"media\" is reserved",
        ),
        (
            "collections: { services: collection({ title: text().notNull() }) }",
            "\"services\" is reserved",
        ),
        (
            "tables: { notes: table({}, { storageName: 'existing' }), other: table({}, { storageName: 'existing' }) }",
            "share the physical name `existing`",
        ),
        (
            "collections: { notes: collection({ title: text().notNull() }) }, tables: { notes: table({}, { storageName: 'other' }) }",
            "duplicate logical registration `notes`",
        ),
        (
            "globals: { status: global('status', { label: text().default('Ready') }) }",
            "\"status\" is reserved by generated client types",
        ),
        (
            "globals: { user: global('user', { label: text().default('Ready') }) }",
            "\"user\" is reserved by generated client types",
        ),
        (
            "globals: { record: global('record', { label: text().default('Ready') }) }",
            "\"record\" is reserved by generated client types",
        ),
        (
            "globals: { client: global('client', { label: text().default('Ready') }) }",
            "\"client\" is reserved by generated client types",
        ),
        (
            "globals: { extract: global('extract', { label: text().default('Ready') }) }",
            "\"extract\" is reserved by generated client types",
        ),
        ("tables: []", "`tables` must be an object"),
        (
            "tables: { notes: table({}), notes: table({}) }",
            "duplicate registration `tables.notes`",
        ),
        ("tables: {}, tables: {}", "duplicate `tables` registry"),
        (
            "uploads: { backend: 's3', bucket: 'uploads', credentials: { accessKeyId: 'literal', secretAccessKey: 'literal' } }",
            "must be env(",
        ),
        (
            "uploads: { backend: 's3', bucket: 'uploads' }",
            "need runtime credentials",
        ),
        ("uploads: { backend: 'local', bucket: 'uploads' }", "has no option"),
        (
            "collections: { notes: collection({ postId: id(), title: text().notNull() }) }",
            "primary key is the WordPress post ID",
        ),
        (
            "collections: { notes: collection({ title: text().notNull() }, { revisions: false }) }",
            "collections always have native revisions",
        ),
        (
            "tables: { notes: table({ title: text() }, { comments: true }) }",
            "only collection() kinds take comments",
        ),
        (
            "collections: { notes: collection({ title: text().notNull() }, { comments: 'yes' }) }",
            "`comments` must be true or false",
        ),
    ] {
        std::fs::write(tmp.path().join("zero.config.ts"), format!(
            "import {{ collection, table, global, id, text, defineConfig }} from 'zero'; const shared = table({{}}); export default defineConfig({{ {body} }});"
        )).unwrap();
        let checked = zero().arg("check").arg(tmp.path()).output().unwrap();
        assert_eq!(checked.status.code(), Some(1));
        assert!(
            String::from_utf8_lossy(&checked.stderr).contains(message),
            "{}",
            String::from_utf8_lossy(&checked.stderr)
        );
        assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 1);
    }
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
        "`stats` must be { visits: number } | null | undefined, not number",
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
    // One site, three trusted CLI actions in a row (the global's first write, its second, a json filter).
    let out = wp_eval_json(
        &tmp.join(".zero/wp-content"),
        r#"$run = static fn (string $name) => json_decode($app->cli(['action', $name])[1], true);
           echo json_encode([$run('visit'), $run('visit'), $run('emptyMeta')]);"#,
        &serde_json::Value::Null,
    );
    assert_eq!(
        out,
        serde_json::json!([
            { "data": ["Hi", null, 1] },
            { "data": ["Hi", { "visits": 1 }, 2] },
            { "data": ["{}"] },
        ])
    );
    let _ = std::fs::remove_dir_all(tmp);
}

/// A handler's `ctx` and a route's `req` are values: helpers typed with the `"zero"` context types
/// take them, return them and read static keys, in compiled PHP as a signed-in user and a guest.
#[test]
fn context_values_pass_through_typed_helpers() {
    let tmp = std::env::temp_dir().join(format!("zero-context-helpers-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/context-helpers"), &tmp);
    let built = zero().arg("build").arg(&tmp).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("eval")
        .arg(tmp.join(".zero/wp-content"))
        .arg(
            r#"$route = $app->matchRoute("POST", "/echo");
               [, $headers, $echo] = $app->serveRoute($route, "POST", "/echo", "", "raw body", [], $wp->user("ada"));
               echo json_encode([
                 "id" => $wp->userId("ada"),
                 "signedIn" => $wp->call("POST", "/actions/whoami", "{}", "ada")[1],
                 "guest" => $wp->call("POST", "/actions/whoami", "{}")[1],
                 "note" => $wp->call("POST", "/actions/note", ["body" => "x"], "ada")[1],
                 "echo" => json_decode($echo, true),
               ]);"#,
        )
        .arg("null")
        .arg("ada=editor")
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "{text}{}", String::from_utf8_lossy(&out.stderr));
    let got: serde_json::Value = serde_json::from_str(text.lines().next_back().unwrap_or("")).unwrap();
    let ada = format!("ada#{}", got["id"]);
    assert_eq!(
        got,
        serde_json::json!({
            "id": got["id"],
            "signedIn": { "label": ada, "role": "editor", "anonymous": false, "viaIndex": false },
            "guest": { "label": "guest", "role": "guest", "anonymous": true, "viaIndex": true },
            "note": [ada],
            "echo": { "method": "POST", "path": "/echo", "body": "raw body", "role": "editor" },
        })
    );
    // Only a key no type can bound is refused, with the fix.
    std::fs::write(
        tmp.join("zero.config.ts"),
        std::fs::read_to_string(tmp.join("zero.config.ts")).unwrap().replace(
            r#"viaIndex: ctx["user"] === null"#,
            "viaIndex: ctx[String(_input)] === null",
        ),
    )
    .unwrap();
    let refused = zero().arg("check").arg(&tmp).output().unwrap();
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert_eq!(refused.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("dynamic keys on an object need a finite key union"),
        "{stderr}"
    );
    assert!(stderr.contains("help: use `keyof` on a finite object"), "{stderr}");
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

/// A fresh WordPress on SQLite with a built `wp-content` installed, served by `php -S`
/// (`php tests/php/wp.php serve`): the site a client and `zero sync` talk to.
struct Server {
    child: Child,
    port: u16,
    /// Credentials by user name: `user:application password`.
    users: serde_json::Value,
    /// The user whose credential goes with every request (writes default to `"editor"` access).
    as_user: Option<String>,
    /// The site directory.
    dir: String,
}

impl Drop for Server {
    fn drop(&mut self) {
        // SIGTERM lets the server remove its site directory.
        let _ = Command::new("kill").arg(self.child.id().to_string()).output();
        let _ = self.child.wait();
    }
}

impl Server {
    fn start(wp_content: &Path, users: &[&str]) -> Server {
        let mut child = Command::new("php")
            .args(["-d", "memory_limit=512M"])
            .arg(root().join("tests/php/wp.php"))
            .arg("serve")
            .arg(wp_content)
            .args(users)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("php");
        let mut line = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .expect("the served site's description");
        let served: serde_json::Value = serde_json::from_str(&line).unwrap_or_else(|_| panic!("serve: {line}"));
        let port: u16 = served["url"]
            .as_str()
            .unwrap()
            .rsplit(':')
            .next()
            .unwrap()
            .parse()
            .unwrap();
        Server {
            child,
            port,
            users: served["users"].clone(),
            as_user: None,
            dir: served["dir"].as_str().unwrap().to_string(),
        }
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn credential(&self, name: &str) -> String {
        self.users[name]["appPassword"].as_str().unwrap().to_string()
    }

    /// Returns (status, body) for a request to Zero's REST route.
    fn send(&self, method: &str, path: &str, body: Option<&str>) -> (u16, serde_json::Value) {
        let mut s = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        let body = body.unwrap_or("");
        // One write: php -S rejects requests whose head arrives in pieces.
        let auth = self
            .as_user
            .as_ref()
            .map(|u| format!("Authorization: Basic {}\r\n", base64(self.credential(u).as_bytes())))
            .unwrap_or_default();
        let request = format!(
            "{method} /wp-json/zero/v1{path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n{auth}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
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

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().fold(0u32, |acc, b| (acc << 8) | *b as u32) << (8 * (3 - chunk.len()));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Run PHP on a fresh WordPress-on-SQLite site with the built wp-content active (`$app`, `$wp`,
/// `$arg` bound; see tests/php/wp.php `eval`); returns stdout.
fn wp_eval(wp_content: &Path, code: &str, arg: &serde_json::Value) -> std::process::Output {
    Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("eval")
        .arg(wp_content)
        .arg(code)
        .arg(arg.to_string())
        .output()
        .unwrap()
}

/// The last JSON line of a `wp_eval` run (WordPress's early notices go to stderr, not here).
fn wp_eval_json(wp_content: &Path, code: &str, arg: &serde_json::Value) -> serde_json::Value {
    let out = wp_eval(wp_content, code, arg);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    serde_json::from_str(text.lines().next_back().unwrap_or("")).unwrap_or_else(|_| panic!("{text}"))
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
    let init = std::fs::read_to_string(project.join("zero/migrations/0001_init.sql")).unwrap();
    assert!(init.contains("CREATE TABLE `{prefix}zero_items`"), "{init}");
    // A second build with no changes adds no migration.
    let again = zero().arg("build").arg(&project).output().unwrap();
    assert!(again.status.success());
    assert!(!project.join("zero/migrations/0002_update.sql").exists());
    for example in ["pantry", "blog", "site"] {
        let stored: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root().join(format!("examples/{example}/zero/migrations/snapshot.json"))).unwrap(),
        )
        .unwrap();
        let persisted = tmp.join(format!("preserved-{example}"));
        copy(&root().join(format!("examples/{example}")), &persisted);
        let result = zero().arg("build").arg(&persisted).output().unwrap();
        assert!(
            result.status.success(),
            "{example}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        let actual: serde_json::Value =
            serde_json::from_slice(&std::fs::read(persisted.join("zero/migrations/snapshot.json")).unwrap()).unwrap();
        assert_eq!(
            actual, stored,
            "{example}: the authoring change must preserve stored resources"
        );
        let migrations = std::fs::read_dir(persisted.join("zero/migrations"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|e| e == "sql"))
            .count();
        let original = std::fs::read_dir(root().join(format!("examples/{example}/zero/migrations")))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|e| e == "sql"))
            .count();
        assert_eq!(
            migrations, original,
            "{example}: no new SQL for an authoring-only change"
        );
    }
    // Main-built storage, including FK targets and revision storage, survives the authoring cut.
    let upgraded = tmp.join("storage-upgrade");
    let fixture = root().join("tests/fixtures/storage-upgrade");
    copy(&fixture, &upgraded);
    let built = zero().arg("build").arg(&upgraded).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    for file in ["snapshot.json", "0001_init.sql"] {
        assert_eq!(
            std::fs::read(upgraded.join("zero/migrations").join(file)).unwrap(),
            std::fs::read(fixture.join("zero/migrations").join(file)).unwrap(),
            "the historical ledger must remain unchanged"
        );
    }
    assert_eq!(std::fs::read_dir(upgraded.join("zero/migrations")).unwrap().count(), 2);

    // Neither camel-case names nor canonical names behind aliases may be silently replaced.
    let conflict = tmp.join("name-conflict");
    std::fs::create_dir_all(&conflict).unwrap();
    std::fs::write(conflict.join("zero.config.ts"), "import { table, defineConfig } from 'zero'; export default defineConfig({ tables: { stockItems: table({}) } });").unwrap();
    let built = zero().arg("build").arg(&conflict).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let ledger = conflict.join("zero/migrations/snapshot.json");
    let canonical: serde_json::Value = serde_json::from_slice(&std::fs::read(&ledger).unwrap()).unwrap();
    for stored_name in ["stockItems", "inventory"] {
        let mut legacy = canonical.clone();
        let tables = legacy["tables"].as_object_mut().unwrap();
        let stored = tables.remove("stock_items").unwrap();
        tables.insert(stored_name.into(), stored);
        let legacy_bytes = serde_json::to_vec(&legacy).unwrap();
        std::fs::write(&ledger, &legacy_bytes).unwrap();
        let refused = zero().arg("build").arg(&conflict).output().unwrap();
        assert_eq!(refused.status.code(), Some(1));
        let error = String::from_utf8_lossy(&refused.stderr);
        assert!(error.contains(&format!("stored resource `{stored_name}`")), "{error}");
        assert!(
            error.contains("an authoring change cannot rename persisted storage"),
            "{error}"
        );
        assert_eq!(std::fs::read(&ledger).unwrap(), legacy_bytes);
        assert_eq!(std::fs::read_dir(conflict.join("zero/migrations")).unwrap().count(), 2);
        std::fs::write(conflict.join("zero.config.ts"), format!("import {{ table, defineConfig }} from 'zero'; export default defineConfig({{ tables: {{ stockItems: table({{}}, {{ storageName: \"{stored_name}\" }}) }} }});")).unwrap();
        let preserved = zero().arg("build").arg(&conflict).output().unwrap();
        assert!(
            preserved.status.success(),
            "{}",
            String::from_utf8_lossy(&preserved.stderr)
        );
        let actual: serde_json::Value = serde_json::from_slice(&std::fs::read(&ledger).unwrap()).unwrap();
        assert_eq!(actual, legacy);
        assert_eq!(std::fs::read_dir(conflict.join("zero/migrations")).unwrap().count(), 2);
        std::fs::write(conflict.join("zero.config.ts"), "import { table, defineConfig } from 'zero'; export default defineConfig({ tables: { stockItems: table({}) } });").unwrap();
    }
    // Physical-only siblings do not establish who owned the retained resource.
    let mut siblings = canonical.clone();
    siblings["tables"]["stockItems"] = canonical["tables"]["stock_items"].clone();
    let sibling_bytes = serde_json::to_vec(&siblings).unwrap();
    std::fs::write(&ledger, &sibling_bytes).unwrap();
    let refused = zero().arg("build").arg(&conflict).output().unwrap();
    assert_eq!(
        refused.status.code(),
        Some(1),
        "{}",
        String::from_utf8_lossy(&refused.stderr)
    );
    let error = String::from_utf8_lossy(&refused.stderr);
    assert!(
        error.contains("stored resource `stockItems` conflicts with canonical physical name `stock_items`"),
        "{error}"
    );
    assert_eq!(std::fs::read(&ledger).unwrap(), sibling_bytes);
    assert_eq!(std::fs::read_dir(conflict.join("zero/migrations")).unwrap().count(), 2);

    // Writes default to editor access: the site's editor signs in with an application password.
    let content = project.join(".zero/wp-content");
    let mut server = Server::start(&content, &["kim=editor"]);
    let (s, denied) = server.send("POST", "/locations", Some(r#"{"name":"Shed"}"#));
    assert_eq!((s, denied["code"].as_str()), (401, Some("unauthenticated")));
    server.as_user = Some("kim".into());

    let (s, loc) = server.send("POST", "/locations", Some(r#"{"name":"Fridge","kind":"fridge"}"#));
    assert_eq!(s, 201, "{loc}");
    let loc_id = loc["data"]["id"].as_i64().unwrap();

    // beforeCreate trims, slugifies, and lowercases tags; afterCreate leaves well-stocked items alone.
    let (s, milk) = server.send(
        "POST",
        "/items",
        Some(&format!(r#"{{"name":"  Oat Milk ","quantity":2,"unit":"l","locationId":{loc_id},"expiresOn":"2000-01-01","tags":["Dairy-Free"]}}"#)),
    );
    assert_eq!(s, 201, "{milk}");
    assert_eq!(milk["data"]["name"], "Oat Milk");
    assert_eq!(milk["data"]["slug"], "oat-milk");
    assert_eq!(milk["data"]["tags"], serde_json::json!(["dairy-free"]));
    let (_, list) = server.send("GET", "/shopping_list", None);
    assert_eq!(list["data"].as_array().unwrap().len(), 0);

    // The consume action runs the update pipeline; afterUpdate restocks at the threshold.
    let milk_id = milk["data"]["id"].as_i64().unwrap();
    let (s, consumed) = server.send("POST", "/actions/consume", Some(&format!(r#"{{"itemId":{milk_id}}}"#)));
    assert_eq!(s, 200, "{consumed}");
    assert_eq!(consumed["data"]["message"], "Oat Milk: 1 l left");
    let (_, list) = server.send("GET", "/shopping_list?with=item", None);
    assert_eq!(list["data"][0]["name"], "Oat Milk");
    assert_eq!(list["data"][0]["item"]["quantity"], 1);
    assert_eq!(list["data"][0]["notifiedAt"], serde_json::Value::Null);

    // §6.1: restocking enqueued notifyLowStock; Action Scheduler runs it off the request (the queue's
    // semantics live in tests/php/jobs_test.php). `wp zero jobs` lists it before and after.
    let jobs = |args: &str| -> serde_json::Value {
        let (_, out) = server.send("GET", "/_schema", None);
        assert_eq!(out["data"]["name"], "pantry");
        serde_json::from_str(&String::from_utf8_lossy(
            &Command::new("php")
                .args(["-d", "memory_limit=512M", "-r"])
                .arg(format!(
                    "require $argv[1]; wpLoad($argv[2]); echo \\Zero\\Wp\\Runtime::plugin()->app()->cli({args})[1];"
                ))
                .arg(root().join("tests/php/wp.php"))
                .arg(server_dir(&server))
                .output()
                .unwrap()
                .stdout,
        ))
        .unwrap()
    };
    let queued = &jobs(r#"['jobs', 'list', '--state', 'pending']"#)["data"];
    assert_eq!(queued.as_array().unwrap().len(), 1, "{queued}");
    assert_eq!(queued[0]["job"], "notifyLowStock");
    assert_eq!(queued[0]["key"], format!("low-{milk_id}"));
    let ran = Command::new("php")
        .args(["-d", "memory_limit=512M", "-r"])
        .arg("require $argv[1]; wpLoad($argv[2]); ActionScheduler_QueueRunner::instance()->run('tests');")
        .arg(root().join("tests/php/wp.php"))
        .arg(server_dir(&server))
        .output()
        .unwrap();
    assert!(ran.status.success(), "{}", String::from_utf8_lossy(&ran.stderr));
    let (_, list) = server.send("GET", "/shopping_list", None);
    assert!(
        list["data"][0]["notifiedAt"].as_str().is_some_and(|t| t.ends_with('Z')),
        "{list}"
    );
    assert_eq!(
        jobs(r#"['jobs', 'list', '--state', 'done']"#)["data"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // The hook's own validation and the runtime's coercion both surface as problems.
    let (s, blank) = server.send("POST", "/items", Some(r#"{"name":"   "}"#));
    assert_eq!((s, blank["detail"].as_str()), (422, Some("name can't be empty")));
    let (s, bad) = server.send("POST", "/actions/consume", Some(r#"{"itemId":999}"#));
    assert_eq!(
        (s, bad["code"].as_str(), bad["detail"].as_str()),
        (404, Some("not_found"), Some("No item 999"))
    );

    // A relation loaded inside an action, with a date computed in PHP.
    let (s, soon) = server.send("POST", "/actions/expiringSoon", Some("{}"));
    assert_eq!(s, 200, "{soon}");
    assert_eq!(
        soon["data"],
        serde_json::json!([{ "name": "Oat Milk", "expiresOn": "2000-01-01", "where": "Fridge" }])
    );

    drop(server);
    let _ = std::fs::remove_dir_all(&tmp);
}

/// The served site's directory (its SQLite database lives below it), for in-process PHP.
fn server_dir(server: &Server) -> PathBuf {
    PathBuf::from(server.dir.as_str())
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
    let oracle: serde_json::Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(oracle["schema"], "zero-differential");
    assert_eq!(oracle["version"], 1);
    assert_eq!(oracle["complete"], true, "oracle must finish every case");
    let expected = &oracle["cases"];
    assert!(!expected.as_object().expect("oracle case map").is_empty());
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
    std::fs::copy(dir.join("namespace.mjs"), tmp.join("namespace.mjs")).unwrap();
    // Plain JavaScript modules the cases import run through checked dynamic dispatch.
    std::fs::copy(dir.join("stdlib.js"), tmp.join("stdlib.js")).unwrap();
    let built = zero().arg("build").arg(&tmp).output().unwrap();
    assert!(
        built.status.success(),
        "build failed:\n{}",
        String::from_utf8_lossy(&built.stderr)
    );
    // The compiled app plugin (named after the project directory) and the runtime beside it.
    let plugins = tmp.join(".zero/wp-content/plugins");
    let app = std::fs::read_dir(&plugins)
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.is_dir() && p.file_name().unwrap().to_string_lossy().starts_with("zero-app-"))
        .expect("the app plugin");
    let runtime = plugins.join("zero-runtime");

    let functions = std::fs::read_to_string(app.join("zero/app/functions.php")).unwrap();
    let body = |name: &str| {
        functions
            .split(&format!("function {name}("))
            .nth(1)
            .expect("differential helper is emitted")
            .split("\nfunction ")
            .next()
            .unwrap()
    };
    assert!(body("nativeParameter").contains("$input->p['n'] ?? \\Zero\\Js::dataGet($input, 'n')"));
    assert!(
        body("nativeParameter")
            .lines()
            .any(|line| line.contains("->p[") && line.contains("] = "))
    );
    assert!(body("nativeMissing").contains("$input->p["));
    assert!(
        body("reboundParameter").contains("\\Zero\\Js::dataGet($input, 'n')")
            && !body("reboundParameter").contains("->p[")
    );
    assert!(
        body("nullableParameter").contains("\\Zero\\Js::dataGet($input, 'n')")
            && !body("nullableParameter").contains("->p[")
    );

    let mut mismatches = Vec::new();
    for (name, want) in expected.as_object().unwrap() {
        let parts: Vec<&str> = name.split(':').collect();
        let out = match parts.as_slice() {
            ["access", _, _, i] => {
                let ctx = &fixtures["ctxs"][i.parse::<usize>().unwrap()];
                php_case(&runtime, &app, name, serde_json::json!({ "ctx": ctx }))
            }
            ["field", _, _, _, i] => {
                let ctx = &fixtures["fctxs"][i.parse::<usize>().unwrap()];
                php_case(&runtime, &app, name, serde_json::json!({ "ctx": ctx }))
            }
            ["validate", c, col, i] => {
                let value = &fixtures["values"][format!("{c}.{col}")][i.parse::<usize>().unwrap()];
                php_case(
                    &runtime,
                    &app,
                    name,
                    serde_json::json!({ "value": value, "ctx": fixtures["vctx"] }),
                )
            }
            // Actions run through the trusted CLI on a site: they may use db(), once() and jobs.
            _ => wp_eval(
                &tmp.join(".zero/wp-content"),
                "echo $app->cli(['action', $arg])[1];",
                &serde_json::Value::String(name.clone()),
            ),
        };
        assert!(
            out.stderr.is_empty(),
            "{name}: PHP emitted diagnostics: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let got: serde_json::Value = serde_json::from_slice(&out.stdout)
            .unwrap_or_else(|_| serde_json::json!({ "raw": String::from_utf8_lossy(&out.stdout) }));
        assert!(
            out.status.success()
                || (out.status.code() == Some(1) && want.get("error").is_some() && got.get("error").is_some()),
            "{name}: unexpected PHP process exit: {:?}: {got}",
            out.status.code()
        );
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

fn php_case(runtime: &Path, app: &Path, case: &str, args: serde_json::Value) -> std::process::Output {
    Command::new("php")
        .arg(root().join("tests/differential/run-php.php"))
        .arg(runtime)
        .arg(app)
        .arg(case)
        .arg(args.to_string())
        .output()
        .unwrap()
}

/// §7.3: the generated client types localized collections; translation ids follow the primary key.
#[test]
fn localized_generated_client_types() {
    let tmp = std::env::temp_dir().join(format!("zero-locales-client-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/locales-client"), &tmp);
    let out = zero().arg("build").arg(&tmp).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    std::fs::write(
        tmp.join("tsconfig.json"),
        serde_json::to_vec(&serde_json::json!({
            "compilerOptions": {
                "strict": true, "noEmit": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
                "paths": { "zero": [root().join("types/zero/index.d.ts")] }
            },
            "files": ["client.ts", "zero.gen.ts"]
        }))
        .unwrap(),
    )
    .unwrap();
    let out = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .arg("--project")
        .arg(tmp.join("tsconfig.json"))
        .output()
        .expect("tsc (or TSC) must be installed to check generated clients");
    assert!(
        out.status.success(),
        "generated client contract failed: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let _ = std::fs::remove_dir_all(tmp);
}

/// §9.1 golden: the frozen phase-1 blog (tests/fixtures/blog/zero.config.ts) compiles to a schema.php
/// equal, as data, to the fixture the runtime and the PHP suites code against. examples/blog, which
/// carries every phase-2 feature, builds the §4.9 plugin with the §7.3 wpml-config.xml golden, passes
/// doctor, and syncs its committed posts into a served site.
#[test]
fn blog_example_matches_the_frozen_schema_and_builds_the_plugin() {
    let tmp = std::env::temp_dir().join(format!("zero-blog-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let frozen = tmp.join("frozen");
    std::fs::create_dir_all(&frozen).unwrap();
    std::fs::copy(
        root().join("tests/fixtures/blog/zero.config.ts"),
        frozen.join("zero.config.ts"),
    )
    .unwrap();
    let project = tmp.join("blog");
    copy(&root().join("examples/blog"), &project);
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

    let golden = as_json(&root().join("tests/fixtures/blog/schema.php"));
    let out = zero().arg("build").arg(&frozen).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(
        as_json(&frozen.join(".zero/wp-content/plugins/zero-app-blog/zero/app/schema.php")),
        golden,
        "schema.php drifted from tests/fixtures/blog/schema.php"
    );

    let out = zero().arg("build").arg(&project).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    // §3.5.1: post-backed columns that only postmeta can filter get a one-line hint.
    assert!(
        String::from_utf8_lossy(&out.stderr).contains(
            "hint: \"posts.authorId\" is filtered through postmeta on WordPress; use table() for SQL data if this list grows large"
        ),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
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
    assert_eq!(manifest["runtime"], "0.3");
    assert_eq!(manifest["app"], "blog");
    for slug in ["zero-runtime", "zero-identity", "zero-app-blog"] {
        let archive = std::fs::File::open(content.join("plugins").join(format!("{slug}.zip"))).unwrap();
        let mut archive = zip::ZipArchive::new(archive).unwrap();
        assert!(archive.by_name(&format!("{slug}/{slug}.php")).is_ok());
    }
    assert!(content.join("plugins/zero-runtime/zero/bootstrap.php").is_file());
    let doctor = zero().args(["doctor", "--json"]).arg(&project).output().unwrap();
    assert!(doctor.status.success(), "{}", String::from_utf8_lossy(&doctor.stdout));
    let doctor: serde_json::Value = serde_json::from_slice(&doctor.stdout).unwrap();
    let platform: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("tests/fixtures/platform.json")).unwrap()).unwrap();
    assert_eq!(doctor["data"]["requirements"], platform);

    // §5.8: the example's committed posts against a fresh site: --check reports them (exit 2), a
    // sync creates them, and a second sync changes nothing. (tests/system/blog.test.ts does the same
    // against WordPress on MariaDB with the plugins installed as a site owner would.)
    let server = Server::start(&content, &["ed=editor"]);
    assert_eq!(server.send("GET", "/auth/config", None).0, 200);
    let credential = server.credential("ed");
    let site = server.url();
    let sync = |extra: &[&str]| {
        zero()
            .arg("sync")
            .arg(&project)
            .env("ZERO_APP_PASSWORD", &credential)
            .args(["--site", &site, "--no-commit", "--json"])
            .args(extra)
            .output()
            .unwrap()
    };
    assert_eq!(sync(&["--check"]).status.code(), Some(2));
    let first = sync(&[]);
    assert_eq!(
        first.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&first.stdout)
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&first.stdout).unwrap()["data"]["applied"],
        2
    );
    let again = sync(&[]);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&again.stdout).unwrap()["data"]["applied"],
        0
    );
    let (_, posts) = server.send("GET", "/posts?orderBy=id", None);
    assert_eq!(posts["data"][0]["title"], "Hello, Zero", "{posts}");
    drop(server);

    // §7.3: localized posts ship a wpml-config.xml, so WPML and Polylang know which fields translate.
    assert_eq!(
        std::fs::read_to_string(plugin.join("wpml-config.xml")).unwrap(),
        std::fs::read_to_string(root().join("tests/fixtures/blog.wpml-config.xml")).unwrap(),
        "wpml-config.xml drifted from tests/fixtures/blog.wpml-config.xml"
    );
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
        ("reject-field-access-self", "self is only allowed on user projection"),
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
        ("reject-sync-auth", "user projections cannot sync"),
        (
            "reject-auth-primary-key",
            "userProjection() needs the primary key id: id()",
        ),
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
        ("reject-auth-duplicate", "at most one userProjection()"),
        (
            "reject-auth-email",
            "userProjection() needs email: email().notNull().unique()",
        ),
        ("reject-auth-drafts", "userProjection() requires drafts: false"),
        ("reject-auth-revisions", "userProjection() requires revisions: false"),
        (
            "reject-auth-slug",
            "user projections cannot have slug() or localized fields",
        ),
        ("reject-auth-self", "self is only allowed on user projection"),
        ("reject-auth-create-self", "self is only allowed on user projection"),
        (
            "reject-auth-reserved-password",
            "password is reserved on user projections",
        ),
        ("reject-auth-reserved-role", "role is reserved on user projections"),
        (
            "reject-auth-reserved-passwordHash",
            "passwordHash is reserved on user projections",
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
            "user projections cannot have slug() or localized fields",
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
        let out = zero()
            .arg("check")
            .arg(root().join("tests/fixtures").join(fixture))
            .output()
            .unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{fixture}: {stderr}");
        assert!(
            stderr.contains(message),
            "{fixture}: expected {message:?}, got {stderr}"
        );
        assert!(
            stderr.contains("--> zero.config.ts:"),
            "{fixture} has no source location: {stderr}"
        );
        assert!(stderr.contains("help:"), "{fixture} has no fix: {stderr}");
    }
    // Mutations must not make a partial field predicate look exhaustive.
    let tmp = std::env::temp_dir().join(format!("zero-phase2-mutations-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    for (body, diagnostic) in [
        (
            "let key: number = 0; for (key in { a: true }) {} return true;",
            "a for-in key is a string",
        ),
        (
            "var key: number; for (var key in { a: true }) {} return true;",
            "loop values are string",
        ),
        (
            "var value: number; for (var value of ['a']) {} return true;",
            "loop values are string",
        ),
        (
            "let key: string | number = 1; if (typeof key === 'number') { for (key in { a: true }) {} return key + 1 > 0; } return false;",
            "is ambiguous",
        ),
        (
            "let key: unknown = 1; if (typeof key === 'number') { const read = () => key; for (key in { a: true }) {} return read() + 1 > 0; } return false;",
            "is ambiguous",
        ),
        (
            "const root: { x: number | string } = { x: 1 }; const alias = root; if (typeof root.x === 'number') { alias.x = 'hi'; return root.x + 1 > 0; } return true;",
            "is ambiguous",
        ),
        (
            "const root: { child: { x: number | string } } = { child: { x: 1 } }; const alias = root.child; if (typeof root.child.x === 'number') { alias.x = 'hi'; return root.child.x + 1 > 0; } return true;",
            "is ambiguous",
        ),
        (
            "const root: { child: { x: number | string } } = { child: { x: 1 } }; const { child } = root; if (typeof root.child.x === 'number') { child.x = 'hi'; return root.child.x + 1 > 0; } return true;",
            "is ambiguous",
        ),
        (
            "const root: { x: number | string } = { x: 1 }; const change = () => { root.x = 'hi'; }; if (typeof root.x === 'number') { change(); return root.x + 1 > 0; } return true;",
            "is ambiguous",
        ),
        (
            "const check = (a: { x: number | string }, b: { x: number | string }) => { if (typeof a.x === 'number') { b.x = 'hi'; return a.x + 1 > 0; } return true; }; const root = { x: 1 }; return check(root, root);",
            "is ambiguous",
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
            "this parameter is declared as number, but it receives number[]",
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
            "const record: { count: 0 | 1 } = { count: 1 }; function bump(...values: { count: 0 | 1 }[]) { const value = values[1]; if (value) value.count++; } bump({ count: 0 }, record); switch (record.count) { case 0: case 1: return true; }",
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
            "function bump(value: { count: 0 | 1 }) { value.count++; } bump({ count: 2 }); return true;",
            "function expects",
        ),
        ("return 'ab'.startsWith('b', 1);", "with a position isn't supported"),
        (
            "return 'ab'.lastIndexOf('b', Number(undefined)) === 1;",
            "position must be a literal number, null or undefined",
        ),
        ("let value: 0 | 1 = 1; value++; value = 2; return true;", "can't assign"),
        (
            "function accept(value: { count: 0 | 1 }) { return true; } const map: Record<string, { count: 0 | 1 }> = {}; return accept(map['missing']);",
            "function expects",
        ),
    ] {
        std::fs::write(tmp.join("zero.config.ts"), format!(
            "import {{ collection, id, text, defineConfig , table}} from 'zero'; const notes = table({{ id: id(), secret: text().access({{ read: (ctx): boolean => {{ {body} }} }}) }}); export default defineConfig({{ tables: {{ notes }} }});"
        )).unwrap();
        let out = zero().arg("check").arg(&tmp).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{stderr}");
        assert!(stderr.contains(diagnostic), "{stderr}");
    }
    for (invocation, diagnostic) in [
        (
            "[1, 2].reduce((acc, item) => { value++; return acc; }, 0)",
            "field rules must return a boolean on every path",
        ),
        (
            "[1, 2].flatMap(item => { value++; return [item]; })",
            "field rules must return a boolean on every path",
        ),
        (
            "[1, 2].findLast(item => { value++; return false; })",
            "field rules must return a boolean on every path",
        ),
        (
            "[1, 2].findLastIndex(item => { value++; return false; })",
            "field rules must return a boolean on every path",
        ),
        (
            "[2, 1].sort((a, b) => { value += 2; return a - b; })",
            "sorting requires a numeric key-difference comparator",
        ),
        (
            "[2, 1].toSorted((a, b) => { value += 2; return a - b; })",
            "sorting requires a numeric key-difference comparator",
        ),
        (
            "Array.from({ length: 2 }, () => { value++; return 1; })",
            "field rules must return a boolean on every path",
        ),
        (
            "const items = [1, 2]; Array.from(items, item => { value++; return item; })",
            "field rules must return a boolean on every path",
        ),
        (
            "'aa'.replace(/a/g, () => { value++; return 'b'; })",
            "field rules must return a boolean on every path",
        ),
        (
            "'aa'.replaceAll('a', () => { value++; return 'b'; })",
            "field rules must return a boolean on every path",
        ),
    ] {
        std::fs::write(tmp.join("zero.config.ts"), format!(
            "import {{ collection, id, text, defineConfig , table}} from 'zero'; const notes = table({{ id: id(), secret: text().access({{ read: (): boolean => {{ let value: 0 | 1 = 0; {invocation}; switch (value) {{ case 0: case 1: return true; }} }} }}) }}); export default defineConfig({{ tables: {{ notes }} }});"
        )).unwrap();
        let out = zero().arg("check").arg(&tmp).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{invocation}: {stderr}");
        assert!(stderr.contains(diagnostic), "{invocation}: {stderr}");
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
            "import {{ collection, id, text, defineConfig , table}} from 'zero'; const notes = table({{ id: id(), secret: text().access({{ read: (): boolean => {{ let value: 0 | 1 = 1; const writers = [() => {{ value++; }}]; {extraction}; switch (value) {{ case 0: case 1: return true; }} }} }}) }}); export default defineConfig({{ tables: {{ notes }} }});"
        )).unwrap();
        let out = zero().arg("check").arg(&tmp).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{extraction}: {stderr}");
        assert!(
            stderr.contains("field rules must return a boolean on every path"),
            "{extraction}: {stderr}"
        );
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
    let out = zero()
        .arg("build")
        .arg(&tmp)
        .env("UPLOAD_SECRET", "compile-time-secret-must-not-resolve")
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let out = Command::new("php")
        .args(["-r", "echo json_encode(require $argv[1]);"])
        .arg(tmp.join(".zero/wp-content/plugins/zero-app-phase2/zero/app/schema.php"))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let actual: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(actual, golden, "v3 metadata drifted");
    // A second build with no changes plans no migration.
    let again = zero().arg("build").arg(&tmp).output().unwrap();
    assert!(again.status.success(), "{}", String::from_utf8_lossy(&again.stderr));
    assert!(
        !tmp.join("zero/migrations/0002_update.sql").exists(),
        "a rebuild planned a migration"
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
    // The compiled closures run on a WordPress site with the plugins active (fields rules, actions,
    // a job handler writing through db()).
    let out = wp_eval(
        &tmp.join(".zero/wp-content"),
        r#"

        $db = \Zero\Db::instance();
        $schema = $db->schema();
        $col = $schema->collection('posts')['columns']['seo']['fields']['label'];
        $fn = '\\ZeroApp\\' . $col['access']['read']['fn'];
        $private = $fn(\Zero\Seam::ctx(['data' => ['label' => 'private'], 'user' => null, 'op' => 'read'], ['label' => ['type' => 'text']]));
        $public = $fn(\Zero\Seam::ctx(['data' => ['label' => 'hello'], 'user' => null, 'op' => 'read'], ['label' => ['type' => 'text']]));
        $authenticated = $fn(\Zero\Seam::ctx(['data' => ['label' => 'hello'], 'user' => ['id' => 1, 'name' => 'Editor', 'role' => 'editor'], 'op' => 'read'], ['label' => ['type' => 'text']]));
        $fieldThrows = false;
        try {
            $fn(\Zero\Seam::ctx(['data' => ['label' => 'error'], 'user' => null, 'op' => 'read'], ['label' => ['type' => 'text']]));
        } catch (\Zero\JsError $error) {
            $fieldThrows = $error->getMessage() === 'denied';
        }
        $action = $schema->action('inbound');
        $fn = '\\ZeroApp\\' . $action['handler'];
        $actor = ['user' => ['id' => 1, 'name' => 'Editor', 'role' => 'editor']];
        $actionAllowed = $fn(\Zero\Seam::toJs(\Zero\Schema::validateInput($action['input'], []), $action['input']), \Zero\Seam::ctx($actor));
        $actionThrows = false;
        try {
            $fn(\Zero\Seam::toJs(\Zero\Schema::validateInput($action['input'], ['allow' => false]), $action['input']), \Zero\Seam::ctx($actor));
        } catch (\Zero\JsError $error) {
            $actionThrows = $error->getMessage() === 'denied';
        }
        $fn = '\\ZeroApp\\' . $schema->action('widened')['handler'];
        $widened = $fn(new \Zero\JsObject());
        // Ordinary array mutation/reduction results belong to the differential
        // owner; this fixture retains their generated-client type proof.
        foreach (['values', 'choice', 'nested', 'reduced', 'reducedNested'] as $key) { unset($widened->p[$key]); }
        $nested = $schema->collection('posts')['columns']['sections']['layouts']['hero']['label'];
        $fn = '\\ZeroApp\\' . $nested['access']['update']['fn'];
        $update = $fn(\Zero\Seam::ctx(['data' => [], 'op' => 'update'] + $actor, []));
        $subscriberUpdate = $fn(\Zero\Seam::ctx(['data' => [], 'op' => 'update', 'user' => ['id' => 2, 'name' => 'Sub', 'role' => 'subscriber']], []));
        $bucket = $schema->files()['decks'];
        $fn = '\\ZeroApp\\' . $bucket['access']['create']['fn'];
        $bucketGuest = $fn(\Zero\Seam::ctx(['user' => null, 'op' => 'create']));
        $job = $schema->jobs()['sendWelcome'];
        $input = \Zero\Schema::validateInput($job['input'], ['email' => 'a@example.com', 'payload' => ['message' => 'typed'], 'data' => ['payload' => ['suffix' => 'nested']]]);
        $ctx = ['user' => null, 'attempt' => 2, 'jobId' => 'job-test'];
        $fn = '\\ZeroApp\\' . $job['handler'];
        $db->transaction(static fn () => $fn(\Zero\Seam::toJs($input, $job['input']), \Zero\Seam::ctx($ctx)));
        echo \Zero\Js::jsonStringify([$private, $public, $authenticated, $fieldThrows, $actionAllowed, $actionThrows, $widened, [$update, $subscriberUpdate], $bucketGuest, $db->findMany('audit')]);
    "#,
        &serde_json::Value::Null,
    );
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    let result: serde_json::Value =
        serde_json::from_str(text.lines().next_back().unwrap_or("")).unwrap_or_else(|_| panic!("{text}"));
    let nullable_arguments = serde_json::json!({"local": 1, "module": 2, "sibling": 3, "stable": "a", "unchecked": {"tail": [null], "reversed": "b", "captured": "b", "forwarded": "b", "grown": "a", "present": true, "defaulted": true, "moduleDefaulted": true, "moduleProvided": false, "destructuredDefault": true, "destructuredProvided": false, "early": null, "late": "b"}, "ordered": 4, "looped": "b", "earlier": 0});
    assert_eq!(
        result,
        serde_json::json!([false, true, false, true, true, true, {"finite": ["a", "b"], "callbacks": [null], "tuples": ["aa"], "finiteDefaults": ["a", "b"], "defaultTuple": "aa", "numeric": {"value": 2, "count": 2, "item": 1, "keep": 0}, "effects": {"captured": 2, "invoked": 2, "loop": 2, "helper": {"count": 3, "captured": 3, "keep": 0}, "shadow": 1, "early": 0, "byValue": 1, "passed": {"object": {"keep": 0}, "destructured": {"keep": 0}}, "callback": 2, "defaulted": 2, "localDefaulted": 2, "logical": {"nullish": 2, "or": 2, "and": 1, "guarded": 3, "absent": 0, "nested": 4}, "nullableArguments": nullable_arguments}, "formatted": "-1", "inferredNumber": "0"}, [true, false], false, [{"id": 1, "note": "typed:job-test:2:nested"}]])
    );
    let _ = std::fs::remove_dir_all(tmp);
}

/// There is one target: `--target` is no longer a flag and `target` no longer a config option, and
/// a plain `zero build` writes the WordPress plugins.
#[test]
fn builds_wordpress_and_knows_no_target_option() {
    let tmp = std::env::temp_dir().join(format!("zero-no-target-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/db-globals"), &tmp);
    let refused = zero().args(["build", "--target", "wp"]).arg(&tmp).output().unwrap();
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert_eq!(refused.status.code(), Some(2), "{stderr}");
    assert!(stderr.contains("unknown option --target for zero build"), "{stderr}");
    let config = std::fs::read_to_string(tmp.join("zero.config.ts")).unwrap();
    std::fs::write(
        tmp.join("zero.config.ts"),
        config.replacen("defineConfig({", "defineConfig({ target: \"wp\",", 1),
    )
    .unwrap();
    let refused = zero().arg("check").arg(&tmp).output().unwrap();
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert_eq!(refused.status.code(), Some(1), "{stderr}");
    assert!(stderr.contains("defineConfig() has no option `target`"), "{stderr}");
    assert!(
        !tmp.join(".zero").exists() && !tmp.join("zero").exists(),
        "a refusal wrote files"
    );
    std::fs::write(tmp.join("zero.config.ts"), config).unwrap();
    let built = zero().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    assert!(tmp.join(".zero/wp-content/zero-manifest.json").is_file());
    assert!(tmp.join("zero/migrations/0001_init.sql").is_file());
    let _ = std::fs::remove_dir_all(tmp);
}

/// A checkout from before the one-directory migration layout is refused, never read as empty: a
/// `wp/` subdirectory, a `sqlite/` subdirectory or a version 1 snapshot each stop the build before it
/// writes, so the numbering cannot restart at 0001 and the plugin cannot ship without its files.
#[test]
fn refuses_the_earlier_migration_layout_instead_of_renumbering() {
    let tmp = std::env::temp_dir().join(format!("zero-legacy-layout-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/db-globals"), &tmp);
    let built = zero().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let migrations = tmp.join("zero/migrations");
    let init = std::fs::read_to_string(migrations.join("0001_init.sql")).unwrap();
    let snapshot = std::fs::read_to_string(migrations.join("snapshot.json")).unwrap();
    /// Every file under the project with its bytes, so a refusal is proven to write nothing anywhere.
    fn tree(dir: &Path) -> std::collections::BTreeMap<PathBuf, Vec<u8>> {
        let mut out = std::collections::BTreeMap::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                out.extend(tree(&path));
            } else {
                out.insert(path.clone(), std::fs::read(&path).unwrap());
            }
        }
        out
    }
    let refused = |message: &str| {
        let before = tree(&tmp);
        let out = zero().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{stderr}");
        assert!(stderr.contains(message), "expected {message:?} in {stderr}");
        assert!(tree(&tmp) == before, "the refusal changed the project");
    };
    for legacy in ["wp", "sqlite"] {
        std::fs::create_dir_all(migrations.join(legacy)).unwrap();
        std::fs::write(migrations.join(legacy).join("0001_init.sql"), &init).unwrap();
        refused(&format!("zero/migrations/{legacy}/ is from an earlier layout"));
        // Following the message: the SQL moved out, the directory deleted. An emptied directory
        // left behind is still the earlier layout.
        std::fs::remove_file(migrations.join(legacy).join("0001_init.sql")).unwrap();
        refused(&format!("zero/migrations/{legacy}/ is from an earlier layout"));
        std::fs::remove_dir(migrations.join(legacy)).unwrap();
    }
    let mut v1: serde_json::Value = serde_json::from_str(&snapshot).unwrap();
    v1["version"] = serde_json::json!(1);
    std::fs::write(
        migrations.join("snapshot.json"),
        serde_json::to_string_pretty(&v1).unwrap() + "\n",
    )
    .unwrap();
    refused("is a version 1 snapshot");
    // Restored, the project builds again and plans nothing new.
    std::fs::write(migrations.join("snapshot.json"), &snapshot).unwrap();
    let again = zero().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
    assert!(again.status.success(), "{}", String::from_utf8_lossy(&again.stderr));
    assert!(!migrations.join("0002_update.sql").exists());
    let _ = std::fs::remove_dir_all(tmp);
}

/// The auth-collection fixture the PHP suites run on is exactly what the compiler emits for it.
#[test]
fn auth_fixture_matches_the_compiler() {
    let tmp = std::env::temp_dir().join(format!("zero-auth-fixture-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    let fixture = root().join("tests/fixtures/auth");
    std::fs::copy(fixture.join("zero.config.ts"), tmp.join("zero.config.ts")).unwrap();
    let out = zero().arg("build").arg(&tmp).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let out = Command::new("php")
        .args(["-r", "echo json_encode(require $argv[1]);"])
        .arg(tmp.join(".zero/wp-content/plugins/zero-app-club/zero/app/schema.php"))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let actual: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let golden: serde_json::Value =
        serde_json::from_slice(&std::fs::read(fixture.join("schema.json")).unwrap()).unwrap();
    assert_eq!(
        actual, golden,
        "tests/fixtures/auth/schema.json drifted from the compiler"
    );
    // The generated client types the user projection as §6.2 says (tests/fixtures/auth/client.ts).
    std::fs::copy(fixture.join("client.ts"), tmp.join("client.ts")).unwrap();
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
        ])
        .arg(tmp.join("client.ts"))
        .output()
        .expect("tsc (or TSC) must be installed to check generated clients");
    assert!(
        out.status.success(),
        "auth client contract failed: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let _ = std::fs::remove_dir_all(&tmp);
}

/// A plugin package from a fixture `node_modules`, registered from the app and run as generated
/// PHP: its hook transforms the row before the app's hook sees it, a write the lock doesn't grant
/// is refused at build, and a runtime-built fetch URL outside the locked hosts is refused at run.
#[test]
fn a_plugin_package_runs_under_its_locked_grant() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("plugins");
    copy(&root().join("tests/fixtures/plugin-seo"), &project);
    let index = project.join("node_modules/zero-plugin-seo/src/index.ts");
    let source = std::fs::read_to_string(&index).unwrap();

    // The owner's lock grants posts.summary only; the same package writing posts.body is refused.
    std::fs::write(
        &index,
        source.replace("data.summary = ", "data.body = \"x\";\n          data.summary = "),
    )
    .unwrap();
    let refused = zero().args(["build", "--frozen"]).arg(&project).output().unwrap();
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert_eq!(refused.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("plugin \"seo\" writes posts.body; zero/plugins.lock.json grants it only posts.summary"),
        "{stderr}"
    );
    assert!(!project.join(".zero").exists(), "a refused plugin generates nothing");

    std::fs::write(&index, source).unwrap();
    let out = zero().args(["build", "--frozen"]).arg(&project).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let got = wp_eval_json(
        &project.join(".zero/wp-content"),
        r#"$row = json_decode($app->cli(['insert', 'posts', '{"title":"Hello plugins"}'])[1], true)['data'][0];
           $denied = json_decode($app->cli(['action', 'seo_lookup', '{"url":"https://elsewhere.example/x"}'])[1], true);
           echo json_encode(['summary' => $row['summary'], 'body' => $row['body'], 'denied' => $denied['error']['code'] ?? $denied]);"#,
        &serde_json::Value::Null,
    );
    assert_eq!(
        got,
        serde_json::json!({
            "summary": "HELLO PLUGIN | Site",
            "body": "seen: HELLO PLUGIN | Site",
            "denied": "zero_fetch_host_denied",
        })
    );
}
