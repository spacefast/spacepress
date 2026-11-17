//! Runtime schema changes end to end (docs/spec/spec.md §2.10): a served WordPress-on-SQLite site
//! changes its schema while it runs; `typedpress pull` writes the versions into the project; the next
//! build contains them; deploying that build changes nothing a client can see and leaves the site's
//! stored additions with nothing to add. Also: a build deployed without the pull keeps the
//! changes, a build that disagrees about a stored type is refused, and a field compiled code names
//! can't be removed at runtime.

use std::io::{BufRead, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn first() -> Command {
    Command::new(env!("CARGO_BIN_EXE_typedpress"))
}

struct Site {
    child: Child,
    port: u16,
    dir: PathBuf,
    editor: String,
    admin: String,
}

impl Drop for Site {
    fn drop(&mut self) {
        // SIGTERM lets the server remove its site directory.
        let _ = Command::new("kill").arg(self.child.id().to_string()).output();
        let _ = self.child.wait();
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

impl Site {
    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// One request to the site's API as `credential` (`user:application password`), or anonymous.
    fn call(
        &self,
        credential: Option<&str>,
        method: &str,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> (u16, serde_json::Value) {
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        let body = body.map(|b| b.to_string()).unwrap_or_default();
        let auth = credential.map_or(String::new(), |c| {
            format!("Authorization: Basic {}\r\n", base64(c.as_bytes()))
        });
        // One write: `write!` sends the request in pieces, and php -S refuses one that arrives split
        // inside its request line.
        let request = format!(
            "{method} /__tp/api/v1{path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n{auth}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        let status = response.get(9..12).and_then(|s| s.parse().ok()).unwrap_or_else(|| {
            // No status line: the server died on this request. Its logs say why.
            let log = |name: &str| std::fs::read_to_string(self.dir.join(name)).unwrap_or_default();
            let tail = |text: String| text.lines().rev().take(12).collect::<Vec<_>>().join("\n");
            panic!(
                "{method} {path} answered {response:?}\nserver.log:\n{}\ndebug.log:\n{}",
                tail(log("server.log")),
                tail(log("content/debug.log"))
            )
        });
        let text = response.split_once("\r\n\r\n").map_or("", |(_, body)| body);
        (status, serde_json::from_str(text).unwrap_or(serde_json::Value::Null))
    }

    fn described(&self) -> serde_json::Value {
        let (status, out) = self.call(None, "GET", "", None);
        assert_eq!(status, 200, "{out}");
        out["data"].clone()
    }

    /// Runs PHP inside the site, as an operator's WP-CLI would: `$versions` is the app's
    /// `SchemaVersions`, `$argv[3]` the JSON argument. Prints one JSON value.
    fn php(&self, code: &str, argument: &serde_json::Value) -> serde_json::Value {
        let script = format!(
            "require $argv[1]; wpLoad($argv[2]); $versions = \\TypedPress\\Wp\\SchemaVersions::of(\\TypedPress\\Wp\\Runtime::plugin()); $in = json_decode($argv[3], true); \
             try {{ $out = (static function () use ($versions, $in) {{ {code} }})(); }} catch (\\TypedPress\\HttpError $e) {{ $out = ['refused' => $e->errorCode, 'status' => $e->status, 'detail' => $e->getMessage()]; }} echo json_encode($out);"
        );
        let out = Command::new("php")
            .args(["-d", "memory_limit=512M", "-r", &script])
            .arg(root().join("tests/php/wp.php"))
            .arg(&self.dir)
            .arg(argument.to_string())
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice(&out.stdout)
            .unwrap_or_else(|_| panic!("php printed {}", String::from_utf8_lossy(&out.stdout)))
    }

    /// Applies a change set on the newest version, as the administrator.
    fn apply(&self, changes: serde_json::Value) -> serde_json::Value {
        self.php(
            "$rows = $versions->list(); return $versions->apply($rows === [] ? 0 : end($rows)['version'], ['format' => 1, 'changes' => $in], ['user' => 1, 'login' => 'admin', 'via' => 'test']);",
            &changes,
        )
    }

    /// Puts the project's built app plugin in place of the site's: a deploy by copying files in.
    fn deploy(&self, project: &Path) {
        let built = project.join("tp/dist/wp-content/plugins/typedpress-app-rtschema");
        let live = self.dir.join("content/plugins/typedpress-app-rtschema");
        std::fs::remove_dir_all(&live).unwrap();
        let out = Command::new("cp").arg("-R").arg(&built).arg(&live).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
}

fn build(project: &Path) -> Output {
    first().arg("build").arg(project).arg("--quiet").output().unwrap()
}

fn pull(project: &Path, site: &Site, credential: &str, extra: &[&str]) -> Output {
    first()
        .arg("pull")
        .arg(project)
        .args(["--site", &site.url()])
        .args(extra)
        .env("TP_APP_PASSWORD", credential)
        .env_remove("TP_TOKEN")
        .output()
        .unwrap()
}

fn text(out: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &to.join(entry.file_name()));
        } else {
            std::fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
        }
    }
}

fn setup() -> (PathBuf, Site) {
    let project = std::env::temp_dir().join(format!("typedpress-rtschema-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&project);
    copy_tree(&root().join("tests/runtime-schema/base"), &project);
    let out = build(&project);
    assert!(out.status.success(), "build: {}", text(&out));
    let mut child = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("serve")
        .arg(project.join("tp/dist/wp-content"))
        .args(["ed=editor", "root=admin"])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("php");
    let mut line = String::new();
    std::io::BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .expect("the served site's description");
    let served: serde_json::Value = serde_json::from_str(&line).unwrap_or_else(|_| panic!("serve: {line}"));
    let credential = |name: &str| served["users"][name]["appPassword"].as_str().unwrap().to_string();
    let port = served["url"]
        .as_str()
        .unwrap()
        .rsplit(':')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    let site = Site {
        child,
        port,
        dir: PathBuf::from(served["dir"].as_str().unwrap()),
        editor: credential("ed"),
        admin: credential("root"),
    };
    (project, site)
}

#[test]
fn a_site_changes_its_schema_the_project_pulls_it_and_the_next_build_contains_it() {
    let (project, site) = setup();
    let lock_path = project.join("tp/_generated/runtime-schema.json");

    // Before any change there is nothing to pull but version 0.
    let out = pull(&project, &site, &site.admin, &[]);
    assert!(out.status.success(), "{}", text(&out));
    let lock: serde_json::Value = serde_json::from_slice(&std::fs::read(&lock_path).unwrap()).unwrap();
    assert_eq!(lock, serde_json::json!({ "format": 1, "version": 0, "hash": "" }));

    // The site changes its schema while it runs.
    let applied = site.apply(serde_json::json!([
        { "op": "addField", "kind": "articles", "field": "subtitle", "definition": { "type": "text", "rules": { "max": 40 } } },
        { "op": "addField", "kind": "articles", "field": "mood", "definition": { "type": "text", "enum": ["calm", "loud"] } },
        { "op": "addCollection", "kind": "events", "definition": { "label": "Events", "access": { "create": "author" },
            "fields": { "title": { "type": "text", "notNull": true }, "starts": { "type": "date" } } } },
        { "op": "addGlobal", "global": "banner", "definition": { "fields": { "text": { "type": "text" } } } },
        { "op": "setLabel", "kind": "articles", "label": "Stories" },
        { "op": "setFieldUi", "kind": "articles", "field": "rating", "ui": { "label": "Stars" } }
    ]));
    assert_eq!(applied["version"], 1, "{applied}");
    let (status, article) = site.call(
        Some(&site.editor),
        "POST",
        "/articles",
        Some(serde_json::json!({ "title": "TypedPress", "subtitle": "Under it", "mood": "calm" })),
    );
    assert_eq!(status, 201, "{article}");
    let article = article["data"]["id"].as_u64().unwrap();
    let (status, event) = site.call(
        Some(&site.editor),
        "POST",
        "/events",
        Some(serde_json::json!({ "title": "Launch", "starts": "2027-03-01" })),
    );
    assert_eq!(status, 201, "{event}");
    let event = event["data"]["id"].as_u64().unwrap();
    let before = site.described();
    assert_eq!(
        before["runtimeSchema"],
        serde_json::json!({ "version": 1, "hash": applied["hash"], "build": { "version": 0, "hash": "" } })
    );

    // Only an administrator reads the site's versions.
    let out = pull(&project, &site, &site.editor, &[]);
    assert!(
        !out.status.success() && text(&out).contains("Only an administrator"),
        "{}",
        text(&out)
    );

    // --check reports the difference and writes nothing; pull writes the lock and refreshes the types.
    let out = pull(&project, &site, &site.admin, &["--check"]);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
    assert!(
        text(&out).contains("holds version 0; the site is at version 1"),
        "{}",
        text(&out)
    );
    let out = pull(&project, &site, &site.admin, &[]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(text(&out).contains("pulled schema version 1"), "{}", text(&out));
    for name in ["articles.subtitle", "articles.mood", "events", "banner"] {
        assert!(
            text(&out).contains(&format!("  {name}: on the site, now also in the project")),
            "{}",
            text(&out)
        );
    }
    let lock: serde_json::Value = serde_json::from_slice(&std::fs::read(&lock_path).unwrap()).unwrap();
    assert_eq!(lock["version"], 1);
    assert_eq!(lock["hash"], applied["hash"]);
    assert_eq!(
        lock["collections"]["articles"]["columns"]["subtitle"],
        serde_json::json!({ "type": "text", "rules": { "max": 40 } })
    );
    assert_eq!(lock["added"]["collections"]["events"]["label"], "Events");
    assert_eq!(
        lock["overrides"]["collections"]["articles"],
        serde_json::json!({ "label": "Stories", "ui": { "rating": { "label": "Stars" } } })
    );
    let types = std::fs::read_to_string(project.join("tp/_generated/db.d.ts")).unwrap();
    assert!(
        types.contains("'subtitle': ColumnBuilder<'text', string, false")
            && types.contains("'events': Collection<'events'"),
        "{types}"
    );
    let out = pull(&project, &site, &site.admin, &["--check"]);
    assert!(
        out.status.success() && text(&out).contains("is at the site's schema version 1"),
        "{}",
        text(&out)
    );

    // The pulled fields are fields: compiled code is typed against them.
    std::fs::create_dir_all(project.join("tp/server")).unwrap();
    std::fs::write(
        project.join("tp/server/headlines.ts"),
        "import { query } from \"typedpress\";\nimport { articles } from \"typedpress:db\";\n\n\
         export const headlines = query({ access: \"anyone\" }, async () => {\n  \
         const rows = await articles.list({ limit: 5 });\n  return rows.map((row) => row.subtitle ?? row.title);\n});\n",
    )
    .unwrap();
    let out = build(&project);
    assert!(out.status.success(), "build after pull: {}", text(&out));
    let plugin = project.join("tp/dist/wp-content/plugins/typedpress-app-rtschema/tp/app");
    let schema_php = std::fs::read_to_string(plugin.join("schema.php")).unwrap();
    assert!(
        schema_php.contains(&format!(
            "'runtimeSchema' => ['version' => 1, 'hash' => '{}'],",
            applied["hash"].as_str().unwrap()
        )),
        "{schema_php}"
    );
    // No SQL was planned for any of it: collections, their fields and globals are posts, meta and options.
    assert!(!project.join("tp/_generated/migrations/0002_update.sql").exists());

    // Deploying that build changes nothing a client sees, and the site's additions have nothing left to add.
    let (_, pre) = site.call(Some(&site.admin), "GET", "/schema-versions/lock", None);
    assert_eq!(
        pre["data"]["deploy"]["kept"],
        serde_json::json!(["articles.subtitle", "articles.mood", "events", "banner"]),
        "{pre}"
    );
    site.deploy(&project);
    let after = site.described();
    assert_eq!(
        after["runtimeSchema"],
        serde_json::json!({ "version": 1, "hash": applied["hash"], "build": { "version": 1, "hash": applied["hash"] } })
    );
    assert_eq!(after["kinds"], before["kinds"]);
    assert_eq!(after["globals"], before["globals"]);
    let (_, post) = site.call(Some(&site.admin), "GET", "/schema-versions/lock", None);
    assert_eq!(post["data"]["deploy"]["kept"], serde_json::json!([]), "{post}");
    assert_eq!(post["data"]["deploy"]["refusals"], serde_json::json!([]));
    let (_, read) = site.call(None, "GET", &format!("/articles/{article}"), None);
    assert_eq!(
        (&read["data"]["subtitle"], &read["data"]["mood"]),
        (&serde_json::json!("Under it"), &serde_json::json!("calm")),
        "{read}"
    );
    let (_, read) = site.call(None, "GET", &format!("/events/{event}"), None);
    assert_eq!(read["data"]["starts"], "2027-03-01", "{read}");
    let (status, ran) = site.call(None, "POST", "/actions/headlines", Some(serde_json::json!({})));
    assert_eq!((status, &ran["data"]), (200, &serde_json::json!(["Under it"])), "{ran}");

    // A field compiled code names can't be removed at runtime; one it never names can, and its data stays.
    let refused = site.apply(serde_json::json!([{ "op": "removeField", "kind": "articles", "field": "subtitle" }]));
    assert_eq!(refused["refused"], "schema_in_use", "{refused}");
    assert!(
        refused["detail"]
            .as_str()
            .unwrap()
            .contains("named in the project's code"),
        "{refused}"
    );
    let removed = site.apply(serde_json::json!([{ "op": "removeField", "kind": "articles", "field": "mood" }]));
    assert_eq!(removed["version"], 2, "{removed}");
    let hidden = site.described();
    assert!(
        hidden["kinds"]["articles"]["columns"].get("mood").is_none()
            && hidden["kinds"]["articles"]["columns"].get("subtitle").is_some(),
        "{hidden}"
    );
    let (status, ran) = site.call(None, "POST", "/actions/headlines", Some(serde_json::json!({})));
    assert_eq!((status, &ran["data"]), (200, &serde_json::json!(["Under it"])), "{ran}");
    let back = site.apply(serde_json::json!([{ "op": "addField", "kind": "articles", "field": "mood", "definition": { "type": "text", "enum": ["calm", "loud"] } }]));
    assert_eq!(back["version"], 3, "{back}");
    let (_, read) = site.call(None, "GET", &format!("/articles/{article}"), None);
    assert_eq!(read["data"]["mood"], "calm", "{read}");

    // A build made without pulling (the original project) is deployed over the site's changes: nothing is dropped.
    let stale = std::env::temp_dir().join(format!("typedpress-rtschema-stale-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&stale);
    copy_tree(&root().join("tests/runtime-schema/base"), &stale);
    assert!(build(&stale).status.success());
    site.deploy(&stale);
    let kept = site.described();
    assert_eq!(
        kept["runtimeSchema"]["build"],
        serde_json::json!({ "version": 0, "hash": "" })
    );
    assert_eq!(kept["runtimeSchema"]["version"], 3);
    for field in ["subtitle", "mood"] {
        assert!(
            kept["kinds"]["articles"]["columns"].get(field).is_some(),
            "{field} was dropped: {kept}"
        );
    }
    assert!(
        kept["kinds"].get("events").is_some() && kept["globals"].get("banner").is_some(),
        "{kept}"
    );
    let (_, read) = site.call(None, "GET", &format!("/articles/{article}"), None);
    assert_eq!(read["data"]["subtitle"], "Under it", "{read}");
    let (_, report) = site.call(Some(&site.admin), "GET", "/schema-versions/lock", None);
    assert_eq!(
        report["data"]["deploy"]["kept"],
        serde_json::json!(["articles.subtitle", "articles.mood", "events", "banner"]),
        "{report}"
    );
    // `wp typedpress migrate` (what a deploy runs) says the same.
    let migrated = site.php(
        "if (!class_exists('WP_CLI')) { eval('final class WP_CLI { public static array $lines = []; public static function line(string $s): void { self::$lines[] = $s; } public static function halt(int $c): never { throw new RuntimeException(\"halt $c\"); } }'); } \
         \\TypedPress\\Wp\\Runtime::plugin()->cli(['migrate']); return json_decode(implode(\"\\n\", WP_CLI::$lines), true);",
        &serde_json::Value::Null,
    );
    assert_eq!(
        migrated["data"]["runtimeSchema"]["kept"],
        serde_json::json!(["articles.subtitle", "articles.mood", "events", "banner"]),
        "{migrated}"
    );
    assert_eq!(
        migrated["data"]["runtimeSchema"]["build"],
        serde_json::json!({ "version": 0, "hash": "" }),
        "{migrated}"
    );

    // A build that declares a runtime field with another stored type is refused, and says what to do.
    std::fs::write(
        stale.join("tp/schema.ts"),
        std::fs::read_to_string(stale.join("tp/schema.ts")).unwrap().replace(
            "rating: integer().optional(),",
            "rating: integer().optional(),\n  subtitle: integer().optional(),",
        ),
    )
    .unwrap();
    assert!(build(&stale).status.success());
    site.deploy(&stale);
    let (status, problem) = site.call(None, "GET", "/articles", None);
    assert_eq!(status, 503, "{problem}");
    let why = site.php(
        "return ['problem' => \\TypedPress\\Wp\\Runtime::plugin()->unavailable()];",
        &serde_json::Value::Null,
    );
    let why = why["problem"].as_str().unwrap_or_default();
    assert!(
        why.contains(
            "articles.subtitle is stored on this site as text (a runtime schema change) and declared in this build as integer"
        ) && why.contains("typedpress pull"),
        "{why}"
    );
    // The refused deploy changed nothing: the pulled build goes back on and the values are there.
    site.deploy(&project);
    let (status, read) = site.call(None, "GET", &format!("/articles/{article}"), None);
    assert_eq!(
        (status, &read["data"]["subtitle"]),
        (200, &serde_json::json!("Under it")),
        "{read}"
    );

    // The next pull brings version 3 into the project; a lock the project can't compile is not written.
    std::fs::write(
        project.join("tp/schema.ts"),
        std::fs::read_to_string(project.join("tp/schema.ts")).unwrap().replace(
            "rating: integer().optional(),",
            "rating: integer().optional(),\n  mood: integer().optional(),",
        ),
    )
    .unwrap();
    let before_pull = std::fs::read_to_string(&lock_path).unwrap();
    let out = pull(&project, &site, &site.admin, &[]);
    assert!(!out.status.success(), "{}", text(&out));
    assert!(
        text(&out).contains("does not compile with this project")
            && text(&out).contains("`mood` is already a field of `articles`"),
        "{}",
        text(&out)
    );
    assert_eq!(std::fs::read_to_string(&lock_path).unwrap(), before_pull);

    let _ = std::fs::remove_dir_all(&project);
    let _ = std::fs::remove_dir_all(&stale);
}
