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
        "zero.config.ts:3:46",
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
}

struct Server {
    child: Child,
    port: u16,
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
        Server { child, port }
    }

    /// Returns (status, body).
    fn send(&self, method: &str, path: &str, body: Option<&str>) -> (u16, serde_json::Value) {
        let mut s = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        let body = body.unwrap_or("");
        // One write: php -S rejects requests whose head arrives in pieces.
        let request = format!(
            "{method} {path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
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
    assert!(project.join("zero/migrations/0001_init.sql").is_file());
    // A second build with no changes adds no migration.
    let again = zero().arg("build").arg(&project).output().unwrap();
    assert!(again.status.success());
    assert!(!project.join("zero/migrations/0002_update.sql").exists());

    let app = project.join(".zero/app");
    let server = Server::start(&app);

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

/// Every action in tests/differential/cases.ts runs under Node and as compiled
/// PHP; the results must be identical. This is what "supported" means.
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

    let mut mismatches = Vec::new();
    for (name, want) in expected.as_object().unwrap() {
        let out = Command::new("php")
            .arg(tmp.join(".zero/app/zero/bin/zero.php"))
            .args(["action", name])
            .output()
            .unwrap();
        let got: serde_json::Value = serde_json::from_slice(&out.stdout)
            .unwrap_or_else(|_| serde_json::json!({ "raw": String::from_utf8_lossy(&out.stdout) }));
        let got = match got.get("error") {
            Some(e) => serde_json::json!({ "error": e["detail"] }),
            None => got,
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
