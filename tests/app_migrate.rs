#![cfg(feature = "cli")]
use serde_json::Value;
use sha2::Digest;
use std::path::{Path, PathBuf};
use std::process::Command;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/app-migrate")
        .join(name)
}
/// `first migrate app` with `flags`; without `--space` or `--unset`, the tables are `--fresh`.
fn migrate(input: &Path, out: &Path, flags: &[&str]) -> (bool, Value) {
    let mode: &[&str] = if ["--space", "--unset", "--fresh"].iter().any(|f| flags.contains(f)) {
        &[]
    } else {
        &["--fresh"]
    };
    let flags: Vec<&str> = flags.iter().copied().filter(|f| *f != "--unset").collect();
    let output = Command::new(env!("CARGO_BIN_EXE_first"))
        .args(["migrate", "app", "--from", "zero-0.8"])
        .arg(input)
        .arg("--out")
        .arg(out)
        .args(mode)
        .args(flags)
        .output()
        .unwrap();
    let report = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&output.stderr)));
    (output.status.success(), report)
}
fn build(project: &Path) {
    let output = Command::new(env!("CARGO_BIN_EXE_first"))
        .arg("build")
        .arg(project)
        .arg("--quiet")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let types = root.join("types/first/index.d.ts");
    // fetch, process and node:crypto come from the standard declarations (tests/host-types).
    let node = root.join("tests/host-types/node_modules/@types");
    assert!(node.join("node").is_dir(), "run: npm ci --prefix tests/host-types");
    std::fs::write(project.join("tsconfig.json"), serde_json::json!({
        "compilerOptions": {"target":"ES2022", "lib":["ES2022"], "module":"ESNext", "moduleResolution":"bundler", "strict":true,"noEmit":true,"types":["node"],"typeRoots":[node],"paths":{"first":[types]}},
        "include":["first.config.ts","first/_generated/db.d.ts","first/server/**/*.ts","first/shared/**/*.ts"]
    }).to_string()).unwrap();
    let checked = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .arg("-p")
        .arg(project)
        .output()
        .expect("tsc or TSC is required");
    assert!(
        checked.status.success(),
        "{}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
}

#[test]
fn generates_compiled_app_and_adoption_snapshot_without_touching_source() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("board");
    let (ok, dry) = migrate(
        &fixture("board"),
        &out,
        &["--space", "spc_migrate_test", "--dry-run", "--json"],
    );
    assert!(ok, "{dry:#}");
    assert_eq!(dry["status"], "dry-run");
    assert!(!out.exists());
    let (ok, written) = migrate(&fixture("board"), &out, &["--space", "spc_migrate_test"]);
    assert!(ok, "{written:#}");
    assert_eq!(written["status"], "written");
    assert_eq!(dry["adoption_sql"], written["adoption_sql"]);
    // Realtime maps: v2 announces every committed write, so the declaration and ctx.invalidate go.
    assert!(
        written["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["pointer"] == "/realtime" && entry["outcome"] == "mapped"),
        "{written:#}"
    );
    let config = std::fs::read_to_string(out.join("first/server/index.ts")).unwrap();
    assert!(!config.contains("invalidate"), "{config}");
    let snapshot: Value =
        serde_json::from_slice(&std::fs::read(out.join("first/_generated/migrations/snapshot.json")).unwrap()).unwrap();
    assert_eq!(snapshot["tables"]["tasks"]["columns"]["id"]["autoIncrement"], true);
    assert_eq!(
        snapshot["tables"]["tasks"]["existingTable"],
        "sf_spc_migrate_test_tasks_3c47092ff0"
    );
    build(&out);
    // The committed adoption snapshot is exactly what build accepts, without a second migration.
    assert_eq!(
        std::fs::read_dir(out.join("first/_generated/migrations"))
            .unwrap()
            .count(),
        2
    );
    let (ok, collision) = migrate(&fixture("board"), &out, &["--space", "spc_migrate_test"]);
    assert!(!ok);
    assert_eq!(collision["status"], "refused");
    assert_eq!(collision["errors"][0]["pointer"], "");
    let mut changed = snapshot;
    changed["tables"]["tasks"]["existingTable"] = "some_other_table".into();
    std::fs::write(
        out.join("first/_generated/migrations/snapshot.json"),
        changed.to_string(),
    )
    .unwrap();
    let check = Command::new(env!("CARGO_BIN_EXE_first"))
        .arg("check")
        .arg(&out)
        .output()
        .unwrap();
    assert!(!check.status.success());
    assert!(String::from_utf8_lossy(&check.stderr).contains("cannot change after the first snapshot"));
}

/// A new Space has no 0.8 tables to adopt: with `--fresh` the candidate declares plain v2 tables
/// and its first migration creates them, so it runs on an empty site.
#[test]
fn fresh_tables_for_a_new_space() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("fresh");
    // Neither --fresh nor --space: one located refusal for the schema, with the choice in its fix.
    let (ok, unset) = migrate(&fixture("board"), &temp.path().join("unset"), &["--unset", "--dry-run"]);
    assert!(!ok);
    assert_eq!(unset["tables"], "unset");
    let errors = unset["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 1, "{unset:#}");
    assert_eq!(errors[0]["code"], "Z08_SPACE_REQUIRED");
    assert_eq!(errors[0]["pointer"], "/schema");
    assert_eq!(
        errors[0]["fix"],
        "Pass --fresh for a Space with no 0.8 tables, or --space <id> to adopt existing ones."
    );
    assert_eq!(
        (errors[0]["file"].as_str(), errors[0]["line"].as_u64()),
        (Some("server/index.ts"), Some(12))
    );
    let (ok, report) = migrate(&fixture("board"), &out, &["--fresh"]);
    assert!(ok, "{report:#}");
    assert_eq!(report["tables"], "fresh");
    assert!(
        report["adoption_sql"]
            .as_str()
            .unwrap()
            .contains("CREATE TABLE `{prefix}first_tasks`")
    );
    let config = std::fs::read_to_string(out.join("first/server/index.ts")).unwrap();
    assert!(!config.contains("existingTable"), "{config}");
    assert!(out.join("first/_generated/migrations/0001_init.sql").is_file());
    assert!(!out.join("first/_generated/migrations/0001_adopt.sql").exists());
    build(&out);
    // The committed init migration is what build expects: no second migration.
    assert_eq!(
        std::fs::read_dir(out.join("first/_generated/migrations"))
            .unwrap()
            .count(),
        2
    );
    let run = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/wp.php"))
        .arg("eval")
        .arg(out.join("first/dist/wp-content"))
        .arg(
            r#"$r = fn ($n, $in) => $wp->call("POST", "/actions/$n", (object) $in, "admin")[1];
               $added = $r("add", ["input" => ["title" => "  Hello  "]]);
               echo json_encode(["added" => [$added["title"], $added["done"], $added["score"], $added["category"]], "count" => $r("count", [])]), "\n";"#,
        )
        .arg("null")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&run.stdout);
    let got: Value = serde_json::from_str(stdout.lines().next_back().unwrap_or(""))
        .unwrap_or_else(|_| panic!("{stdout}{}", String::from_utf8_lossy(&run.stderr)));
    assert_eq!(
        got,
        serde_json::json!({ "added": ["Hello", false, 2, "inbox"], "count": 1 })
    );
    // A Space binding still adopts, and the two modes exclude each other.
    let (ok, adopted) = migrate(
        &fixture("board"),
        &temp.path().join("adopt"),
        &["--space", "spc_migrate_test", "--dry-run"],
    );
    assert!(ok);
    assert_eq!(adopted["tables"], "adopt");
    let both = Command::new(env!("CARGO_BIN_EXE_first"))
        .args(["migrate", "app", "--from", "zero-0.8"])
        .arg(fixture("board"))
        .args(["--out", "/nonexistent-first-out", "--fresh", "--space", "s"])
        .output()
        .unwrap();
    assert_eq!(both.status.code(), Some(2));
    // A schema refusal in fresh mode has its own code, whose fix is about the new table.
    let root = temp.path().join("bad-default");
    project(
        &root,
        r#"{ name: "b", schema: { notes: table({ body: string().default(Date.now() as unknown as string) }) } }"#,
    );
    let index = root.join("server/index.ts");
    let text = std::fs::read_to_string(&index)
        .unwrap()
        .replace("import { capsule }", "import { capsule, string, table }");
    std::fs::write(&index, text).unwrap();
    let (ok, fresh) = migrate(&root, &temp.path().join("bad-fresh"), &["--dry-run"]);
    assert!(!ok);
    assert_eq!(fresh["errors"][0]["code"], "Z08_SCHEMA_FRESH", "{fresh:#}");
    let (ok, adopt) = migrate(&root, &temp.path().join("bad-adopt"), &["--space", "s", "--dry-run"]);
    assert!(!ok);
    assert_eq!(adopt["errors"][0]["code"], "Z08_SCHEMA", "{adopt:#}");
}

#[test]
fn reuses_content_importer_and_normalizes_roles_without_claiming_grants() {
    let temp = tempfile::tempdir().unwrap();
    // Connector roles normalize, but their credentials and grants stay behind, so each one is an
    // omission: publishing the candidate would break calls through it.
    let (ok, refused) = migrate(&fixture("content"), &temp.path().join("refused"), &["--dry-run"]);
    assert!(!ok);
    assert_eq!(refused["connector_roles"]["calendar"]["as"], "personal");
    assert_eq!(refused["connector_roles"]["shared"]["as"], "team");
    assert_eq!(refused["connector_roles"]["visitor"]["as"], "visitor");
    let omitted: Vec<(&str, &str)> = refused["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["code"].as_str().unwrap(), e["pointer"].as_str().unwrap()))
        .collect();
    assert_eq!(
        omitted,
        [
            ("Z08_OMITTED_CONNECTORS", "/connectors/calendar"),
            ("Z08_OMITTED_CONNECTORS", "/connectors/shared"),
            ("Z08_OMITTED_CONNECTORS", "/connectors/visitor"),
        ]
    );
    // Without them the content importer still converts and builds.
    let root = temp.path().join("content");
    copy_tree(&fixture("content"), &root);
    let index = root.join("server/index.ts");
    let source = std::fs::read_to_string(&index).unwrap();
    let start = source.find("  connectors: {").unwrap();
    let end = start + source[start..].find("  },\n").unwrap() + "  },\n".len();
    std::fs::write(&index, format!("{}{}", &source[..start], &source[end..])).unwrap();
    let out = temp.path().join("out");
    let (ok, report) = migrate(&root, &out, &[]);
    assert!(ok, "{report:#}");
    build(&out);
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

/// Fail closed: everything a 0.8 publish served that the candidate does not reproduce is an
/// error with its own code, and static files v2 serves unchanged are carried into public/.
#[test]
fn omissions_are_errors_and_static_files_carry_over() {
    let temp = tempfile::tempdir().unwrap();
    let (ok, report) = migrate(
        &fixture("omitted"),
        &temp.path().join("omitted"),
        &["--space", "spc_migrate_test", "--dry-run"],
    );
    assert!(!ok);
    let errors: Vec<(&str, &str, &str, u64)> = report["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["code"].as_str().unwrap(),
                e["pointer"].as_str().unwrap(),
                e["file"].as_str().unwrap(),
                e["line"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        errors,
        [
            ("Z08_PAGE_DOCUMENT", "/pages/about.md", "pages/about.md", 1),
            ("Z08_OMITTED_CONNECTORS", "/connectors/calendar", "server/index.ts", 5),
            ("Z08_OMITTED_REDIRECTS", "/_redirects", "_redirects", 1),
            ("Z08_OMITTED_STATIC", "/assets/logo.png", "assets/logo.png", 1),
            ("Z08_OMITTED_CLIENT", "/client", "client/index.tsx", 1),
            ("Z08_OMITTED_PUBLIC", "/public/site.css", "public/site.css", 1),
            ("Z08_OMITTED_SERVE", "/sf.jsonc/fallback", "sf.jsonc", 5),
            // A key the converter doesn't know to be a no-op is refused, not passed through.
            ("Z08_OMITTED_CONFIG", "/sf.jsonc/meta", "sf.jsonc", 6),
            // Located at the top-level key, not at the "theme" string inside meta.
            ("Z08_OMITTED_CONFIG", "/sf.jsonc/theme", "sf.jsonc", 7),
            ("Z08_OMITTED_CONFIG", "/theme.json", "theme.json", 1),
        ],
        "{report:#}"
    );
    let registry: Value = serde_json::from_str(include_str!("compatibility/registry.json")).unwrap();
    for (code, ..) in &errors {
        assert!(
            registry["zero08"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["code"] == *code),
            "{code}"
        );
    }
    // With pages, 0.8 served the author's index.html, so it travels with the other text files.
    let carried: Vec<&str> = report["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["reason"].as_str().unwrap().starts_with("static file carried over"))
        .map(|e| e["pointer"].as_str().unwrap())
        .collect();
    // Plain JavaScript outside the source roots is content 0.8 served (zero-compile's capsule test
    // publishes assets/search.js); TypeScript is never served, wherever it is.
    assert_eq!(
        carried,
        ["/assets/app.css", "/assets/app.js", "/docs/guide.html", "/index.html"]
    );
    // A client app with no pages is converted (#192), which clears Z08_OMITTED_CLIENT. 0.8
    // generated its index.html, so the author's never served and isn't carried; the converted app
    // owns public/ and reports a clash there itself.
    let standalone = temp.path().join("standalone");
    copy_tree(&fixture("omitted"), &standalone);
    std::fs::remove_dir_all(standalone.join("pages")).unwrap();
    let (_, report) = migrate(
        &standalone,
        &temp.path().join("standalone-out"),
        &["--space", "spc_migrate_test", "--dry-run"],
    );
    let codes: Vec<&str> = report["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["code"].as_str().unwrap())
        .collect();
    assert!(
        !codes.contains(&"Z08_OMITTED_CLIENT") && !codes.contains(&"Z08_OMITTED_PUBLIC"),
        "{report:#}"
    );
    assert!(
        !report["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["pointer"] == "/index.html" && e["reason"].as_str().unwrap().starts_with("static file"))
    );

    // runtime.client outside client/ (web/main.tsx), no pages: the client converts and its
    // generated shell stays public/index.html; the author's index.html, which 0.8 never served,
    // neither overwrites it nor travels.
    let elsewhere = temp.path().join("client-elsewhere");
    let (ok, report) = migrate(
        &fixture("client-elsewhere"),
        &elsewhere,
        &["--space", "spc_migrate_test", "--zero-css", styles()],
    );
    assert!(ok, "{report:#}");
    let shell = std::fs::read_to_string(elsewhere.join("public/index.html")).unwrap();
    assert!(
        shell.contains("<div id=\"root\"></div>") && !shell.contains("Author shell"),
        "{shell}"
    );
    assert!(elsewhere.join("public/notes.css").is_file());

    // A symbolic link is never followed: it could reach a secret or a file outside the project.
    let linked = temp.path().join("linked");
    copy_tree(&fixture("server-only"), &linked);
    std::fs::write(linked.join(".env.server"), "SECRET=1\n").unwrap();
    std::os::unix::fs::symlink(".env.server", linked.join("public-secret.txt")).unwrap();
    std::fs::create_dir(linked.join("docs")).unwrap();
    std::os::unix::fs::symlink(std::env::temp_dir(), linked.join("docs/outside")).unwrap();
    let out = temp.path().join("linked-out");
    let (ok, report) = migrate(&linked, &out, &["--space", "spc_migrate_test"]);
    assert!(!ok);
    let refused: Vec<(&str, &str)> = report["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["code"].as_str().unwrap(), e["file"].as_str().unwrap()))
        .collect();
    assert_eq!(
        refused,
        [
            ("Z08_DENIED_SOURCE_FILE", ".env.server"),
            ("Z08_OMITTED_SYMLINK", "docs/outside"),
            ("Z08_OMITTED_SYMLINK", "public-secret.txt")
        ],
        "{report:#}"
    );
    assert!(!out.exists());

    // The monorepo's source deny list (source-archive-policy.ts), one case per alternative: a
    // credential is an error at its file, never carried and never dropped. Checkout state,
    // dependencies and OS metadata are skipped without one.
    let secrets = temp.path().join("secrets");
    copy_tree(&fixture("server-only"), &secrets);
    let denied = [
        "deploy_id_rsa",
        "backup.id_rsa",
        "id_ed25519.pub",
        "cert.PEM",
        "docs/.npmrc",
        "docs/.netrc",
        ".pypirc",
        ".env.production",
        ".dev.vars",
        "credentials.json",
        "x-private-key",
        ".ssh/config",
        ".aws/credentials",
        ".env/secret",
    ];
    // Skipped without an error as 0.8 did: checkout state, dependencies, OS metadata, the
    // runtime's own paths (staticUploadPathViolation) and build caches (publishPathIgnored).
    let skipped = [
        ".git/config",
        "node_modules/left-pad/index.js",
        ".DS_Store",
        "docs/._guide.txt",
        ".htaccess",
        "docs/.user.ini",
        "__spacefast_generated/old.txt",
        "__sf/a.txt",
        "identity/a.txt",
        ".zero-compiled/a.txt",
        ".well-known/stattic-runtime",
        ".next/cache/a.txt",
        ".spacefast-0123456789abcdef01234567.lock",
        "tsconfig.build.json",
    ];
    for path in denied.iter().chain(&skipped).chain(&[
        "invalid_rsa_key.json",
        "tsconfig-foo.json",
        "tsconfigs.json",
        ".sf/notes.txt",
    ]) {
        let file = secrets.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, "{\"secret\":1}\n").unwrap();
    }
    let out = temp.path().join("secrets-out");
    let (ok, report) = migrate(&secrets, &out, &["--space", "spc_migrate_test", "--dry-run"]);
    assert!(!ok);
    let mut refused: Vec<(&str, &str)> = report["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["code"].as_str().unwrap(), e["file"].as_str().unwrap()))
        .collect();
    refused.sort();
    let mut expected: Vec<(&str, &str)> = denied.iter().map(|p| ("Z08_DENIED_SOURCE_FILE", *p)).collect();
    expected.sort();
    assert_eq!(refused, expected, "{report:#}");
    let carried: Vec<&str> = report["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["reason"].as_str().unwrap().starts_with("static file carried over"))
        .map(|e| e["pointer"].as_str().unwrap())
        .collect();
    // A fixture that only contains the letters is content.
    // Only `tsconfig.json` and `tsconfig.<name>.json` were project files.
    // Under .sf/ only the config aliases are non-content.
    assert_eq!(
        carried,
        [
            "/.sf/notes.txt",
            "/humans.txt",
            "/index.html",
            "/invalid_rsa_key.json",
            "/tsconfig-foo.json",
            "/tsconfigs.json",
        ],
        "{report:#}"
    );

    // A server-only project: no errors, and its static files land in public/ at the same URLs.
    // The keys Spacefast applies to the Space travel unchanged in the candidate's own sf.jsonc,
    // which the v2 publish uploads; the 0.8 runtime and name don't.
    let platform = temp.path().join("server-only-source");
    copy_tree(&fixture("server-only"), &platform);
    let settings = serde_json::json!({
        "redirects": [{ "source": "/old", "destination": "/new", "status": 301 }],
        "cleanUrls": false,
        // The string form has no path patterns, and v2's /wp-json lane enforces it the same way.
        "access": "public",
        "build": { "outputDirectory": "dist" },
        // The host keeps calling a cron's path with GET; a carried static file still answers it.
        "crons": [{ "key": "humans", "path": "/humans.txt", "schedule": "0 * * * *" }],
    });
    let mut config = settings.clone();
    config["runtime"] = serde_json::json!({ "kind": "zero", "server": "server/index.ts" });
    config["name"] = "Server only".into();
    std::fs::write(
        platform.join("sf.jsonc"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();
    // Space overlay settings the committed file can't set: refused at the key, not reported carried.
    let mut overlay = config.clone();
    overlay["dataSources"] = serde_json::json!({ "blog": { "url": "https://blog.example" } });
    overlay["network"] = serde_json::json!({ "egress": "allowlist" });
    // The engine checks a rewrite's path, and compiles a listing, against 0.8 pages only, so on v2
    // they would take over the app's URLs: refused.
    overlay["rewrites"] = serde_json::json!([{ "source": "/(.*)", "destination": "/index.html" }]);
    overlay["listing"] = true.into();
    // access path patterns and sell (its product file and paid assets would be swept into public/)
    // don't apply the same way: refused. A cron whose path the candidate doesn't serve is refused
    // at the entry.
    overlay["access"] = serde_json::json!({ "public": ["/docs/**"] });
    // On v2 the app's data URLs are /wp-json/first/v1/*, which nothing reserves from redirects: a
    // rule whose source can reach them is refused (here a catch-all host move).
    overlay["redirects"] = serde_json::json!([
        { "source": "/old", "destination": "/new", "status": 301 },
        { "source": "/*", "destination": "https://new.example/:splat", "status": 301 }
    ]);
    // Path rules don't survive the move: the app's data URLs move to /wp-json/first/v1/*.
    overlay["firewall"] =
        serde_json::json!([{ "name": "no-rest", "action": "block", "match": { "path": "/wp-json/*" } }]);
    overlay["cache"] = serde_json::json!({ "bypass": ["/__zero/*"] });
    overlay["crons"] = serde_json::json!([
        { "key": "humans", "path": "/humans.txt", "schedule": "0 * * * *" },
        { "key": "nightly", "path": "/api/nightly", "schedule": "0 3 * * *" }
    ]);
    overlay["sell"] = serde_json::json!({ "mode": "test", "products": "sell/products.json" });
    // Header rules apply to response-table entries only, so on v2 they would skip the app's
    // WordPress-rendered pages: refused.
    overlay["headers"] =
        serde_json::json!([{ "source": "/(.*)", "headers": [{ "key": "x-frame-options", "value": "DENY" }] }]);
    std::fs::write(
        platform.join("sf.jsonc"),
        serde_json::to_string_pretty(&overlay).unwrap(),
    )
    .unwrap();
    let (ok, refused) = migrate(
        &platform,
        &temp.path().join("overlay"),
        &["--space", "spc_migrate_test", "--dry-run"],
    );
    assert!(!ok);
    let refused: Vec<(&str, &str)> = refused["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["code"].as_str().unwrap(), e["pointer"].as_str().unwrap()))
        .collect();
    assert_eq!(
        refused,
        [
            // Keys keep their place in the file: redirects (a rule can reach /wp-json), access
            // (path patterns), then the one cron whose path nothing serves.
            ("Z08_OMITTED_CONFIG", "/sf.jsonc/redirects"),
            ("Z08_OMITTED_CONFIG", "/sf.jsonc/access"),
            ("Z08_OMITTED_CRON", "/sf.jsonc/crons/1"),
            ("Z08_OMITTED_CONFIG", "/sf.jsonc/dataSources"),
            ("Z08_OMITTED_CONFIG", "/sf.jsonc/network"),
            ("Z08_OMITTED_SERVE", "/sf.jsonc/rewrites"),
            ("Z08_OMITTED_SERVE", "/sf.jsonc/listing"),
            ("Z08_OMITTED_CONFIG", "/sf.jsonc/firewall"),
            ("Z08_OMITTED_CONFIG", "/sf.jsonc/cache"),
            ("Z08_OMITTED_CONFIG", "/sf.jsonc/sell"),
            ("Z08_OMITTED_SERVE", "/sf.jsonc/headers"),
        ]
    );
    std::fs::write(
        platform.join("sf.jsonc"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();
    let out = temp.path().join("server-only");
    let (ok, report) = migrate(&platform, &out, &["--space", "spc_migrate_test"]);
    assert!(ok, "{report:#}");
    assert_eq!(report["errors"], serde_json::json!([]));
    let carried: Value = serde_json::from_str(&std::fs::read_to_string(out.join("sf.jsonc")).unwrap()).unwrap();
    assert_eq!(carried, settings);
    assert_eq!(
        std::fs::read_to_string(out.join("public/index.html")).unwrap(),
        std::fs::read_to_string(platform.join("index.html")).unwrap()
    );
    assert!(out.join("public/humans.txt").is_file());
    // Repository files and source are not content.
    for absent in ["public/package.json", "public/sf.jsonc", "public/server/index.ts"] {
        assert!(!out.join(absent).exists(), "{absent}");
    }
    build(&out);

    // With no config file, the page carries over with no error and no sf.jsonc: the engine serves
    // public/'s static files as it served 0.8's (`.htm` keeps its name on both).
    let bare = temp.path().join("bare");
    copy_tree(&fixture("server-only"), &bare);
    std::fs::remove_file(bare.join("sf.jsonc")).unwrap();
    std::fs::write(bare.join("about.htm"), "<p>About</p>\n").unwrap();
    let out = temp.path().join("bare-out");
    let (ok, report) = migrate(&bare, &out, &["--space", "spc_migrate_test"]);
    assert!(ok, "{report:#}");
    assert!(out.join("public/about.htm").is_file());
    assert!(!out.join("sf.jsonc").exists());
}

#[test]
fn reports_all_unsupported_features_and_never_writes_a_refused_app() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("refused");
    let (ok, report) = migrate(&fixture("refused"), &out, &["--space", "spc_migrate_test"]);
    assert!(!ok);
    assert_eq!(report["status"], "refused");
    let pointers: Vec<_> = report["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["pointer"].as_str().unwrap())
        .collect();
    assert_eq!(
        pointers,
        [
            "/pages/live.tsx",
            "/auth/onGuestUpgrade",
            "/queries/email/ctx/email",
            "/queries/identity/ctx/auth/userId",
            "/queries/pages/ctx/db/tasks"
        ]
    );
    assert!(!out.exists());
    let (ok, compiled_only) = migrate(&fixture("zero-all-features"), &out, &["--dry-run"]);
    assert!(!ok);
    assert!(
        compiled_only["errors"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("compiled finalize payloads are not capsule source")
    );
}

/// Every refusal carries the diagnostic contract a publish response shows: a registered stable code,
/// the 0.8 file, line and column, the feature, its v2 equivalent and a one-line fix.
#[test]
fn every_refusal_carries_the_diagnostic_contract() {
    let registry: Value = serde_json::from_str(include_str!("compatibility/registry.json")).unwrap();
    let codes: Vec<&str> = registry["zero08"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["code"].as_str().unwrap())
        .collect();
    let temp = tempfile::tempdir().unwrap();
    let (ok, report) = migrate(
        &fixture("refused"),
        &temp.path().join("out"),
        &["--space", "spc_migrate_test", "--dry-run"],
    );
    assert!(!ok);
    let errors = report["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 5, "{report}");
    for e in errors {
        for key in ["feature", "v2", "fix"] {
            let text = e[key].as_str().unwrap_or_else(|| panic!("{key} in {e}"));
            assert!(!text.is_empty() && !text.contains('\n'), "{e}");
        }
        assert!(codes.contains(&e["code"].as_str().unwrap()), "{e}");
        let file = e["file"].as_str().unwrap();
        assert!(fixture("refused").join(file).is_file(), "{e}");
        assert!(
            e["line"].as_u64().unwrap() >= 1 && e["column"].as_u64().unwrap() >= 1,
            "{e}"
        );
    }
    let at = |pointer: &str| errors.iter().find(|e| e["pointer"] == pointer).unwrap();
    // `ctx.auth.userId` on line 9 of the capsule, at the expression itself.
    let source = std::fs::read_to_string(fixture("refused").join("server/index.ts")).unwrap();
    let line = source.lines().nth(8).unwrap();
    let identity = at("/queries/identity/ctx/auth/userId");
    assert_eq!(
        (
            identity["code"].as_str(),
            identity["file"].as_str(),
            identity["line"].as_u64()
        ),
        (Some("Z08_CTX_AUTH_USERS"), Some("server/index.ts"), Some(9))
    );
    assert_eq!(
        identity["column"].as_u64().unwrap() as usize,
        line.find("ctx.auth.userId").unwrap() + 1
    );
    assert_eq!(at("/auth/onGuestUpgrade")["code"], "Z08_AUTH_CALLBACK");
    assert_eq!(at("/pages/live.tsx")["file"], "pages/live.tsx");
    // A construct the v2 compiler refuses names itself in `feature`, located in the converted entry.
    let capsule = temp.path().join("with");
    project(&capsule, "{}");
    std::fs::write(
        capsule.join("server/index.ts"),
        "import { capsule, query, string, table } from \"@spacefast/zero/server\";\nfunction f(o: { a: number }) { with (o) { return a; } }\nexport default capsule({ name: \"g\", schema: { notes: table({ body: string() }) }, queries: { n: query(async (ctx) => f({ a: 1 })) } });\n",
    )
    .unwrap();
    let (ok, report) = migrate(
        &capsule,
        &temp.path().join("out-with"),
        &["--space", "spc_migrate_test", "--dry-run"],
    );
    assert!(!ok);
    let e = &report["errors"][0];
    assert_eq!(e["code"], "Z08_LANGUAGE", "{report}");
    assert_eq!(e["feature"], "JavaScript construct: `with`", "{e}");
    assert_eq!(
        (e["file"].as_str(), e["line"].as_u64(), e["column"].as_u64()),
        (Some("server/index.ts"), Some(2), Some(32)),
        "{e}"
    );
}

/// A handler that passes `ctx` to a helper, aliases it or destructures it keeps working: the helper
/// takes the v2 context and its services are rewritten as the handler's are, following calls
/// between helpers. Run on WordPress as a signed-in member and a guest.
#[test]
fn ctx_passed_to_helpers_aliased_or_destructured_converts() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("helpers");
    let (ok, report) = migrate(&fixture("helpers"), &out, &["--space", "spc_migrate_test", "--users"]);
    assert!(ok, "{report:#}");
    let mapped: Vec<&str> = report["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["pointer"].as_str().unwrap().starts_with("/helpers/"))
        .map(|e| e["pointer"].as_str().unwrap())
        .collect();
    assert_eq!(
        mapped,
        [
            "/helpers/authed",
            "/helpers/bearer",
            "/helpers/getHeader",
            "/helpers/listAll",
            "/helpers/originOf",
            "/helpers/owner",
            "/helpers/prefix",
            "/helpers/readBody",
            "/helpers/save",
            "/helpers/subject"
        ]
    );
    build(&out);
    // The candidate adopts existing 0.8 tables; run it on a fresh site with its own.
    let source = std::fs::read_to_string(out.join("first/server/index.ts")).unwrap();
    let fresh = regex::Regex::new(r#"existingTable: "[^"]*", "#)
        .unwrap()
        .replace_all(&source, "");
    std::fs::write(out.join("first/server/index.ts"), fresh.as_ref()).unwrap();
    std::fs::remove_dir_all(out.join("first/_generated/migrations")).unwrap();
    let built = Command::new(env!("CARGO_BIN_EXE_first"))
        .arg("build")
        .arg(&out)
        .arg("--quiet")
        .output()
        .unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let run = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/wp.php"))
        .arg("eval")
        .arg(out.join("first/dist/wp-content"))
        .arg(
            r#"putenv("NOTE_PREFIX=hi ");
               putenv("NOTE_KEY=k1");
               $r = fn ($n, $in, $as) => $wp->call("POST", "/actions/$n", (object) $in, $as)[1];
               // The endpoint hands its request to helpers: a header check through two of them, then
               // the JSON body through a third.
               $post = fn ($auth) => $app->serveRoute($app->matchRoute("POST", "/api/notes"), "POST", "/api/notes", "", "{\"body\":\"three\"}", ["Authorization" => $auth], null, "https://notes.example/api/notes")[0];
               $denied = $post("Bearer nope");
               // 0.8's request.url: https, the host as served, share-link secrets redacted.
               $parse = fn ($body) => json_decode($app->serveRoute($app->matchRoute("POST", "/api/parse"), "POST", "/api/parse", "", $body, [], null, "https://notes.example/api/parse")[2], true);
               $where = json_decode($app->serveRoute($app->matchRoute("GET", "/api/where"), "GET", "/api/where", "t=1", "", [], null, \First\Wp\HttpRoutes::url("Notes.Example:8080", "/api/where?__=s&t=1"))[2], true);
               $saved = $post("Bearer k1");
               echo json_encode([
                 "denied" => $denied, "saved" => $saved, "where" => $where, "parsed" => $parse("{\"a\":1}"), "unparsed" => $parse("{"),
                 "add" => $r("add", ["body" => "one"], "ada"),
                 "addGuest" => $r("add", ["body" => "two"], null),
                 "list" => array_map(fn ($n) => [$n["body"], $n["owner"]], $r("list", [], null)),
                 "greeting" => $r("greeting", [], "ada"),
                 "greetingGuest" => $r("greeting", [], null),
                 "me" => $r("me", [], "ada"),
                 "id" => $wp->userId("ada"),
               ]), "\n";"#,
        )
        .arg("null")
        .arg("ada=subscriber")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&run.stdout);
    let got: Value = serde_json::from_str(stdout.lines().next_back().unwrap_or(""))
        .unwrap_or_else(|_| panic!("{stdout}{}", String::from_utf8_lossy(&run.stderr)));
    assert_eq!(
        got,
        serde_json::json!({
            "add": true, "addGuest": false,
            "denied": 403, "saved": 201,
            "parsed": { "a": 1 }, "unparsed": { "invalid": true },
            "where": { "origin": "https://notes.example", "url": "https://notes.example/api/where?__=[redacted]&t=1" },
            "list": [["two", "anonymous"], ["one", "ada"], ["three", "anonymous"]],
            "greeting": "hi ada", "greetingGuest": "hi anonymous",
            // A member without a copied 0.8 subject answers wp:<id>, as in a handler.
            "me": format!("wp:{}", got["id"]),
            "id": got["id"],
        })
    );

    // A helper shared by a query and a mutation converts read-only, and reads the subject two
    // calls down: the mutation still answers 401 to a caller without an identity, so no row is
    // written with a null owner, while the query answers null.
    let shared = temp.path().join("helper-subject");
    let (ok, report) = migrate(
        &fixture("helper-subject"),
        &shared,
        &["--space", "spc_migrate_test", "--users"],
    );
    assert!(ok, "{report:#}");
    let source = std::fs::read_to_string(shared.join("first/server/index.ts")).unwrap();
    std::fs::write(
        shared.join("first/server/index.ts"),
        regex::Regex::new(r#"existingTable: "[^"]*", "#)
            .unwrap()
            .replace_all(&source, "")
            .as_ref(),
    )
    .unwrap();
    std::fs::remove_dir_all(shared.join("first/_generated/migrations")).unwrap();
    build(&shared);
    let run = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/wp.php"))
        .arg("eval")
        .arg(shared.join("first/dist/wp-content"))
        .arg(
            r#"$r = fn ($n, $in, $as) => $wp->call("POST", "/actions/$n", (object) $in, $as);
               echo json_encode([
                 "guestAdd" => $r("add", ["body" => "x"], null)[0],
                 "guestWhoami" => $r("whoami", [], null)[1],
                 "memberAdd" => $r("add", ["body" => "y"], "ada")[1],
                 "rows" => $wp->scalar("SELECT COUNT(*) FROM {prefix}first_notes"),
                 "id" => $wp->userId("ada"),
               ]), "\n";"#,
        )
        .arg("null")
        .arg("ada=subscriber")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&run.stdout);
    let got: Value = serde_json::from_str(stdout.lines().next_back().unwrap_or(""))
        .unwrap_or_else(|_| panic!("{stdout}{}", String::from_utf8_lossy(&run.stderr)));
    assert_eq!(
        got,
        serde_json::json!({
            "guestAdd": 401, "guestWhoami": null,
            "memberAdd": format!("wp:{}", got["id"]), "rows": 1, "id": got["id"],
        })
    );

    // Only what the converter can't follow is refused, with the contract and a location.
    for (case, helper, handler, code, reason) in [
        (
            "key",
            "",
            "queries: { k: query(async (ctx, key: string) => String(ctx[key])) }",
            "Z08_CTX_DYNAMIC",
            "a key the converter can't follow",
        ),
        (
            "stored",
            "",
            "queries: { k: query(async (ctx) => { const holder = { ctx }; return String(holder.ctx.env.X); }) }",
            "Z08_CTX_DYNAMIC",
            "escapes into a value",
        ),
        (
            "nested",
            "",
            "queries: { k: query(async (ctx) => { const { auth: { userId } } = ctx; return userId; }) }",
            "Z08_CTX_DYNAMIC",
            "plain service names",
        ),
        (
            "sync",
            "function who(ctx: any) { return ctx.auth.userId; }",
            "queries: { k: query(async (ctx) => String(who(ctx))) }",
            "Z08_CTX_DYNAMIC",
            "make the helper async",
        ),
        // A query can't reach a write through a helper, as it couldn't directly.
        (
            "read",
            "async function put(ctx: any) { await ctx.db.notes.insert({ body: \"x\" }); }",
            "queries: { k: query(async (ctx) => { await put(ctx); return 1; }) }",
            "Z08_DB_WRITE_IN_READ",
            "writes are only allowed",
        ),
        // A request handed to a helper follows the endpoint's request rules, and the helper's
        // parameter must be one plain name.
        (
            "request-api",
            "async function form(req: any) { return req.formData(); }",
            "endpoints: { e: endpoint({ method: \"POST\", path: \"/e\" }, async (_ctx, req) => text(String(await form(req)))) }",
            "Z08_ENDPOINT_REQUEST_API",
            "request API has no v2 route equivalent",
        ),
        (
            "request-destructured",
            "function auth({ headers }: any) { return headers.get(\"authorization\"); }",
            "endpoints: { e: endpoint({ method: \"GET\", path: \"/e\" }, (_ctx, req) => text(auth(req) ?? \"\")) }",
            "Z08_ENDPOINT_REQUEST_API",
            "request API has no v2 route equivalent",
        ),
        // A nested binding with the request's name is not the request; it is refused, not rewritten.
        (
            "request-shadowed",
            "function first(req: any, list: any[]) { return list.map((req: any) => req.headers.get(\"x\")).join(); }",
            "endpoints: { e: endpoint({ method: \"GET\", path: \"/e\" }, (_ctx, req) => text(first(req, []))) }",
            "Z08_CTX_DYNAMIC",
            "shadowed context",
        ),
        // A promise returned unawaited from a `try` escaped its catch in 0.8; awaiting it would not.
        (
            "request-returned-in-try",
            "",
            "endpoints: { e: endpoint({ method: \"POST\", path: \"/e\" }, async (_ctx, req) => { try { return req.json(); } catch { return text(\"caught\"); } }) }",
            "Z08_ENDPOINT_REQUEST_API",
            "request API has no v2 route equivalent",
        ),
        (
            "request-helper-returned-in-try",
            "async function body(req: any) { return req.text(); }",
            "endpoints: { e: endpoint({ method: \"POST\", path: \"/e\" }, async (_ctx, req) => { try { return body(req); } finally { } }) }",
            "Z08_ENDPOINT_REQUEST_API",
            "request API has no v2 route equivalent",
        ),
        // A sync helper returning an async request helper's promise has no v2 form either.
        (
            "request-sync-chain",
            "async function body(r: any) { return r.text(); } function read(r: any) { return body(r); }",
            "endpoints: { e: endpoint({ method: \"POST\", path: \"/e\" }, async (_ctx, req) => text(await read(req))) }",
            "Z08_ENDPOINT_REQUEST_API",
            "request API has no v2 route equivalent",
        ),
        // Zero awaits every async call, so a body read held as a promise has no v2 form.
        (
            "request-held",
            "",
            "endpoints: { e: endpoint({ method: \"POST\", path: \"/e\" }, async (_ctx, req) => { const p = req.text(); return text(await p); }) }",
            "Z08_ENDPOINT_REQUEST_API",
            "request API has no v2 route equivalent",
        ),
        (
            "request-signatures",
            "function method(x: any) { return String(x.method); }",
            "endpoints: { e: endpoint({ method: \"GET\", path: \"/e\" }, (ctx, req) => text(method(req) + method(ctx))) }",
            "Z08_CTX_DYNAMIC",
            "different argument positions",
        ),
    ] {
        let root = temp.path().join(case);
        project(&root, "{}");
        std::fs::write(
            root.join("server/index.ts"),
            format!("import {{ capsule, endpoint, query, string, table, text }} from \"@spacefast/zero/server\";\n{helper}\nexport default capsule({{ name: \"r\", schema: {{ notes: table({{ body: string() }}) }}, {handler} }});\n"),
        )
        .unwrap();
        let (ok, refused) = migrate(
            &root,
            &temp.path().join(format!("{case}-out")),
            &["--space", "spc_migrate_test", "--users", "--dry-run"],
        );
        assert!(!ok, "{case}");
        let e = &refused["errors"][0];
        assert_eq!(e["code"], code, "{case}: {refused:#}");
        assert!(e["reason"].as_str().unwrap().contains(reason), "{case}: {e}");
        assert_eq!(e["file"], "server/index.ts", "{case}: {e}");
        assert!(e["line"].as_u64().unwrap() >= 2, "{case}: {e}");
    }
}

fn project(root: &Path, capsule: &str) {
    std::fs::create_dir_all(root.join("server")).unwrap();
    std::fs::write(root.join("sf.jsonc"), r#"{"runtime":{"kind":"zero"}}"#).unwrap();
    std::fs::write(
        root.join("server/index.ts"),
        format!("import {{ capsule }} from '@spacefast/zero/server'; export default capsule({capsule});"),
    )
    .unwrap();
}

/// 0.8 rebuilt `content/posts/` into the Space's posts on every publish. The candidate adopts the
/// post rows but doesn't rebuild them from the files, so the files are refused rather than served
/// raw; without them, the posts are adopted.
#[test]
fn spacefast_content_only_root_adopts_native_posts_and_maps_realtime() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("source");
    project(&root, r#"{name:"spacefast-posts", realtime:{enabled:true}}"#);
    std::fs::create_dir_all(root.join("content/posts/2026")).unwrap();
    std::fs::write(root.join("content/posts/hello.md"), "---\ntitle: Hello\n---\nBody").unwrap();
    std::fs::write(root.join("content/posts/2026/later.html"), "<p>Later</p>").unwrap();
    let (ok, refused) = migrate(&root, &temp.path().join("refused"), &["--dry-run"]);
    assert!(!ok);
    let errors: Vec<(&str, &str, &str)> = refused["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["code"].as_str().unwrap(),
                e["pointer"].as_str().unwrap(),
                e["file"].as_str().unwrap(),
            )
        })
        .collect();
    // One error for the directory, located at its first file; nothing is carried as static.
    assert_eq!(
        errors,
        [("Z08_OMITTED_POSTS", "/content/posts", "content/posts/2026/later.html")],
        "{refused:#}"
    );
    // A declared `collections.posts` turned off 0.8's structural default, so 0.8 only served the
    // files: they carry over as static files, with no posts error.
    let declared = temp.path().join("declared");
    project(
        &declared,
        r#"{name:"spacefast-posts", collections:{posts:{label:"Posts"}}}"#,
    );
    std::fs::create_dir_all(declared.join("content/posts")).unwrap();
    std::fs::write(declared.join("content/posts/hello.md"), "---\ntitle: Hello\n---\nBody").unwrap();
    let (ok, carried) = migrate(&declared, &temp.path().join("declared-out"), &["--dry-run"]);
    assert!(ok, "{carried:#}");
    assert!(
        carried["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["pointer"] == "/content/posts/hello.md"),
        "{carried:#}"
    );
    std::fs::remove_dir_all(root.join("content/posts")).unwrap();
    std::fs::create_dir_all(root.join("content/posts")).unwrap();
    let out = temp.path().join("candidate");
    let (ok, report) = migrate(&root, &out, &[]);
    assert!(ok, "{report:#}");
    let snapshot: Value =
        serde_json::from_slice(&std::fs::read(out.join("first/_generated/migrations/snapshot.json")).unwrap()).unwrap();
    assert_eq!(snapshot["tables"]["posts"]["editor"], true);
    assert!(
        report["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["pointer"] == "/realtime" && entry["outcome"] == "mapped")
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&std::fs::read(out.join("connector-roles.json")).unwrap()).unwrap(),
        serde_json::json!({})
    );
    build(&out);
}

#[test]
fn native_post_declarations_and_space_users_compile_together() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("source");
    project(
        &root,
        r#"{collections:{posts:{publicRead:true,fields:{title:{kind:"text",required:true},content:{kind:"blocks"}},sync:{directory:"content/posts"}},notes:{fields:{title:{kind:"text",required:true}}}}}"#,
    );
    // 0.8 rebuilt synced posts on every publish; the candidate doesn't, so sync is an omission.
    let (ok, refused) = migrate(&root, &temp.path().join("synced"), &["--users", "--dry-run"]);
    assert!(!ok);
    assert_eq!(refused["errors"][0]["code"], "Z08_OMITTED_SYNC", "{refused:#}");
    assert_eq!(refused["errors"][0]["pointer"], "/collections/posts/sync");
    let index = root.join("server/index.ts");
    let text = std::fs::read_to_string(&index)
        .unwrap()
        .replace(r#",sync:{directory:"content/posts"}"#, "");
    std::fs::write(&index, text).unwrap();
    let out = temp.path().join("candidate");
    let (ok, report) = migrate(&root, &out, &["--users"]);
    assert!(ok, "{report:#}");
    let snapshot: Value =
        serde_json::from_slice(&std::fs::read(out.join("first/_generated/migrations/snapshot.json")).unwrap()).unwrap();
    let keys: Vec<_> = snapshot["tables"].as_object().unwrap().keys().cloned().collect();
    assert!(keys.contains(&"posts".to_string()), "{keys:?}");
    assert!(keys.contains(&"notes".to_string()), "{keys:?}");
    assert!(keys.contains(&"members".to_string()), "{keys:?}");
    build(&out);
}

#[test]
fn spacefast_pages_layouts_islands_and_endpoints_refuse_with_pointers() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("source");
    project(&root, r#"{endpoints:{health:{method:"GET",path:"/health"}}}"#);
    for dir in ["pages", "layouts", "islands"] {
        std::fs::create_dir_all(root.join(dir)).unwrap();
        std::fs::write(root.join(dir).join("index.tsx"), "export default () => null;").unwrap();
    }
    // A static page maps; one that keeps state in the browser does not.
    std::fs::write(
        root.join("pages/counter.tsx"),
        "import { useState } from \"preact/hooks\";\nexport default () => { const [n] = useState(0); return <p>{n}</p>; };",
    )
    .unwrap();
    let out = temp.path().join("candidate");
    let (ok, report) = migrate(&root, &out, &[]);
    assert!(!ok);
    let pointers: Vec<_> = report["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["pointer"].as_str().unwrap())
        .collect();
    assert_eq!(
        pointers,
        [
            "/islands/index.tsx",
            "/layouts/index.tsx",
            "/pages/counter.tsx",
            "/endpoints/health"
        ]
    );
    assert!(!out.exists());
}

fn corpus(name: &str) -> PathBuf {
    fixture("corpus").join(name)
}

/// Copies a corpus project without the parts a test does not exercise.
fn trimmed(name: &str, root: &Path, drop: &[&str], edit: impl Fn(String) -> String) {
    let from = corpus(name);
    for entry in walk(&from) {
        let relative = entry.strip_prefix(&from).unwrap();
        if drop.iter().any(|d| relative.starts_with(d)) {
            continue;
        }
        let target = root.join(relative);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        let text = std::fs::read_to_string(&entry).unwrap();
        let text = if relative == Path::new("server/index.ts") {
            edit(text)
        } else {
            text
        };
        std::fs::write(target, text).unwrap();
    }
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            out.extend(walk(&path));
        } else {
            out.push(path);
        }
    }
    out
}

fn without_endpoints(text: String) -> String {
    let start = text.find("  endpoints: {").expect("endpoints");
    let end = start + text[start..].find("\n  },\n").expect("end") + 5;
    format!("{}{}", &text[..start], &text[end..])
}

#[test]
fn space_user_subjects_back_owner_scoped_handlers() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("todo");
    trimmed("starter-todo", &root, &["pages", "client"], without_endpoints);
    let out = temp.path().join("candidate");
    // Without Space Users, which First user a Spacefast account or a 0.8 guest becomes is an open
    // owner decision (Sign in with Spacefast), so userId stays refused and the refusal says so.
    let (ok, refused) = migrate(&root, &out, &["--space", "spc_migrate_test", "--dry-run"]);
    assert!(!ok);
    let error = &refused["errors"][0];
    assert_eq!(error["pointer"], "/queries/todos/ctx/auth/userId");
    assert_eq!(error["code"], "Z08_CTX_AUTH_USERS");
    let reason = error["reason"].as_str().unwrap();
    for named in ["account:<id>", "guest:<id>", "owner decision", "Sign in with Spacefast"] {
        assert!(reason.contains(named), "{named}: {reason}");
    }
    assert!(
        error["fix"].as_str().unwrap().contains("keep the app on 0.8"),
        "{error}"
    );
    let (ok, report) = migrate(&root, &out, &["--space", "spc_migrate_test", "--users"]);
    assert!(ok, "{report:#}");
    let entries = report["entries"].as_array().unwrap();
    assert!(
        entries
            .iter()
            .any(|e| e["pointer"] == "/name" && e["reason"].as_str().unwrap().contains("\"todo\""))
    );
    assert!(
        entries
            .iter()
            .any(|e| e["pointer"] == "/auth" && e["outcome"] == "review")
    );
    let snapshot: Value =
        serde_json::from_slice(&std::fs::read(out.join("first/_generated/migrations/snapshot.json")).unwrap()).unwrap();
    assert_eq!(
        snapshot["tables"]["members"]["columns"]["spacefastSubject"]["type"], "text",
        "{:#}",
        snapshot["tables"]["members"]
    );
    build(&out);
}

/// A Space Users session gave 0.8 handlers `provider: "space-users"` and no email, picture,
/// subject or aliases, so with `--users` those fields convert to exactly that; without Space Users
/// they came from the visitor's Spacefast account, which waits on the Sign in with Spacefast
/// decision, so they are refused with a message naming it.
#[test]
fn profile_fields_convert_for_space_users_and_name_the_decision_otherwise() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("todo");
    trimmed("starter-todo", &root, &["pages", "client"], |text| {
        without_endpoints(text).replacen(
            "  queries: {\n",
            "  queries: {\n    me: query(async (ctx) => ({ provider: ctx.auth.provider, email: ctx.auth.email ?? null, picture: ctx.auth.picture ?? null, verified: ctx.auth.emailVerified === true })),\n",
            1,
        )
    });
    let (ok, refused) = migrate(
        &root,
        &temp.path().join("refused"),
        &["--space", "spc_migrate_test", "--dry-run"],
    );
    assert!(!ok);
    let profile: Vec<&Value> = refused["errors"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["pointer"].as_str().unwrap().starts_with("/queries/me/ctx/auth/"))
        .collect();
    assert!(!profile.is_empty(), "{refused:#}");
    for e in profile {
        assert_eq!(e["code"], "Z08_CTX_AUTH_PROFILE", "{e}");
        assert!(e["reason"].as_str().unwrap().contains("Sign in with Spacefast"), "{e}");
    }
    let out = temp.path().join("candidate");
    let (ok, report) = migrate(&root, &out, &["--space", "spc_migrate_test", "--users"]);
    assert!(ok, "{report:#}");
    build(&out);
    let source = std::fs::read_to_string(out.join("first/server/index.ts")).unwrap();
    let fresh = regex::Regex::new(r#"existingTable: "[^"]*", "#)
        .unwrap()
        .replace_all(&source, "");
    std::fs::write(out.join("first/server/index.ts"), fresh.as_ref()).unwrap();
    std::fs::remove_dir_all(out.join("first/_generated/migrations")).unwrap();
    build(&out);
    let run = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/wp.php"))
        .arg("eval")
        .arg(out.join("first/dist/wp-content"))
        .arg(r#"echo json_encode(["member" => $wp->call("POST", "/actions/me", (object) [], "ada")[1], "anonymous" => $wp->call("POST", "/actions/me", (object) [], null)[1]]), "\n";"#)
        .arg("null")
        .arg("ada=subscriber")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&run.stdout);
    let got: Value = serde_json::from_str(stdout.lines().next_back().unwrap_or(""))
        .unwrap_or_else(|_| panic!("{stdout}{}", String::from_utf8_lossy(&run.stderr)));
    assert_eq!(
        got,
        serde_json::json!({
            "member": { "provider": "space-users", "email": null, "picture": null, "verified": false },
            "anonymous": { "provider": null, "email": null, "picture": null, "verified": false },
        })
    );
}

#[test]
fn a_page_importing_a_component_module_refuses_at_the_page() {
    let temp = tempfile::tempdir().unwrap();
    for import in ["../shared/Widget", "../shared/Widget.tsx"] {
        let root = temp.path().join(import.replace(['.', '/'], "_"));
        project(&root, r#"{name:"p"}"#);
        std::fs::create_dir_all(root.join("shared")).unwrap();
        std::fs::create_dir_all(root.join("pages")).unwrap();
        std::fs::write(
            root.join("shared/Widget.tsx"),
            "export function Widget() { return <b>w</b>; }\n",
        )
        .unwrap();
        std::fs::write(
            root.join("pages/index.tsx"),
            format!("import {{ Widget }} from \"{import}\";\nexport default function Home() {{ return <main><Widget /></main>; }}\n"),
        )
        .unwrap();
        let (ok, refused) = migrate(&root, &root.with_extension("out"), &["--dry-run"]);
        assert!(!ok);
        assert_eq!(
            refused["errors"][0]["pointer"], "/pages/index.tsx",
            "{import}: {refused:#}"
        );
        assert!(
            refused["errors"][0]["reason"]
                .as_str()
                .unwrap()
                .contains("component module shared/Widget.tsx"),
            "{import}: {refused:#}"
        );
    }
}

#[test]
fn a_0_8_id_type_keeps_its_table_argument() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("ids");
    project(
        &root,
        r#"{schema:{notes:table({body:string()})},queries:{get:query(async (ctx, id: Id<"notes">) => ctx.db.notes.get(id))}}"#,
    );
    let source = std::fs::read_to_string(root.join("server/index.ts")).unwrap().replace(
        "import { capsule }",
        "import { capsule, query, string, table, type Id }",
    );
    std::fs::write(root.join("server/index.ts"), source).unwrap();
    let out = temp.path().join("candidate");
    let (ok, report) = migrate(&root, &out, &["--space", "spc_migrate_test"]);
    assert!(ok, "{report:#}");
    build(&out);
}

#[test]
fn paginate_maps_to_keyset_reads_and_refuses_optional_keys() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("feed");
    let (ok, report) = migrate(&fixture("feed"), &out, &["--space", "spc_migrate_test"]);
    assert!(ok, "{report:#}");
    let paginated: Vec<_> = report["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["reason"].as_str().unwrap().starts_with("paginate keeps"))
        .map(|e| e["pointer"].as_str().unwrap())
        .collect();
    assert_eq!(paginated, ["/queries/latest", "/queries/channel"]);
    build(&out);
    let root = temp.path().join("optional");
    project(
        &root,
        r#"{schema:{notes:table({tag:string().optional()}).index("by_tag",["tag"])},queries:{page:query(async (ctx, options: PaginationOptions) => ctx.db.notes.withIndex("by_tag").paginate(options))}}"#,
    );
    let source = std::fs::read_to_string(root.join("server/index.ts")).unwrap().replace(
        "import { capsule }",
        "import { capsule, query, string, table, type PaginationOptions }",
    );
    std::fs::write(root.join("server/index.ts"), source).unwrap();
    let (ok, refused) = migrate(&root, &temp.path().join("refused"), &["--space", "spc_migrate_test"]);
    assert!(!ok);
    assert_eq!(refused["errors"][0]["pointer"], "/queries/page/ctx/db/notes");
    assert!(
        refused["errors"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("optional field tag")
    );
}

#[test]
fn endpoints_become_routes_and_unroutable_ones_refuse() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("endpoints");
    let (ok, report) = migrate(&fixture("endpoints"), &out, &["--space", "spc_migrate_test", "--users"]);
    assert!(ok, "{report:#}");
    let routes: Vec<_> = report["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["reason"].as_str().unwrap().strip_prefix("v2 route "))
        .map(|r| r.split(" with ").next().unwrap().to_string())
        .collect();
    assert_eq!(
        routes,
        [
            "GET /api/ping",
            "GET /api/banner",
            "GET /api/notes/:id",
            "GET /api/notes/count",
            "POST /api/search",
            "PUT /api/notes",
            "DELETE /api/notes/:id",
            "GET /go/home",
            "GET /api/tags",
            "GET /api/files/*splat",
            "POST /api/marks",
            "GET /api/total"
        ]
    );
    // 0.8's `/api/files/:splat` also answered `/api/files`; v2 needs a second route for it.
    assert!(report["entries"].as_array().unwrap().iter().any(|e| {
        e["pointer"] == "/endpoints/file"
            && e["reason"]
                .as_str()
                .unwrap()
                .starts_with("GET /api/files also reaches this handler")
    }));
    build(&out);
    let root = temp.path().join("refused");
    project(
        &root,
        r#"{endpoints:{
          head:endpoint({method:"HEAD",path:"/x"},()=>text("")),
          rest:endpoint({method:"GET",path:"/:splat"},()=>text("")),
          star:endpoint({method:"GET",path:"/a/*rest"},()=>text("")),
          mid:endpoint({method:"GET",path:"/a/:splat/b"},()=>text("")),
          admin:endpoint({method:"GET",path:"/wp-admin/x"},()=>text("")),
          root:endpoint({method:"GET",path:"/"},()=>text("")),
          hit:endpoint({method:"GET",path:"/hit",readOnly:false},(ctx)=>text(String(ctx.auth.isSignedIn))),
          bytes:endpoint({method:"POST",path:"/bytes"},async (_ctx, req)=>text(String((await req.bytes()).length))),
          one:endpoint({method:"GET",path:"/a/:x"},()=>text("")),
          two:endpoint({method:"GET",path:"/a/:y"},()=>text(""))
        }}"#,
    );
    let source = std::fs::read_to_string(root.join("server/index.ts"))
        .unwrap()
        .replace("import { capsule }", "import { capsule, endpoint, text }");
    std::fs::write(root.join("server/index.ts"), source).unwrap();
    let (ok, refused) = migrate(&root, &temp.path().join("no"), &[]);
    assert!(!ok);
    let pointers: Vec<_> = refused["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["pointer"].as_str().unwrap())
        .collect();
    assert_eq!(
        pointers,
        [
            "/endpoints/head/method",
            "/endpoints/rest/path",
            "/endpoints/star/path",
            "/endpoints/mid/path",
            "/endpoints/admin/path",
            "/endpoints/root/path",
            "/endpoints/bytes/request/bytes",
            "/endpoints/two",
            // Decided once every helper is known: this writing GET reads the visitor.
            "/endpoints/hit"
        ]
    );
}

#[test]
fn the_unused_favicon_option_is_dropped_with_a_review_entry() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("source");
    project(&root, r#"{name:"Icon",favicon:"/icon.png",schema:{}}"#);
    let out = temp.path().join("candidate");
    let (ok, report) = migrate(&root, &out, &[]);
    assert!(ok, "{report:#}");
    let entry = report["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["pointer"] == "/favicon")
        .expect("favicon entry");
    assert_eq!(entry["outcome"], "review");
    let config = std::fs::read_to_string(out.join("first/server/index.ts")).unwrap();
    assert!(!config.contains("icon.png"), "{config}");
    build(&out);
}

#[test]
fn env_and_log_services_map_to_v2_builtins() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("services");
    let (ok, report) = migrate(&fixture("services"), &out, &[]);
    assert!(ok, "{report:#}");
    build(&out);
}

#[test]
fn static_pages_move_to_tsx_pages_and_interactive_ones_refuse() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("site");
    let (ok, report) = migrate(&fixture("site"), &out, &["--space", "spc_migrate_test"]);
    assert!(ok, "{report:#}");
    for file in [
        "pages/page.tsx",
        "pages/pricing/page.tsx",
        "pages/docs/page.tsx",
        "pages/layout.tsx",
        "first/shared/plans.ts",
    ] {
        assert!(out.join(file).is_file(), "{file}");
    }
    let pricing = std::fs::read_to_string(out.join("pages/pricing/page.tsx")).unwrap();
    assert!(
        pricing.contains("import { plans } from '../../first/shared/plans';"),
        "a single-quoted relative import moves with the page and into the Zero root: {pricing}"
    );
    // Only parsed import declarations move, side-effect imports included; a string, a comment or
    // JSX text that merely reads like one keeps its exact bytes.
    let site = temp.path().join("site-src");
    copy_tree(&fixture("site"), &site);
    std::fs::write(site.join("shared/setup.ts"), "export {};\n").unwrap();
    std::fs::write(
        site.join("shared/meta.ts"),
        "export const metadata = { title: \"About\" };\n",
    )
    .unwrap();
    let decoys = [
        "// from '../shared/plans' is where the tiers live",
        "const caption = \"from '../shared/plans'\";",
        "<p>{caption} and from \"../shared/plans\"</p>",
    ];
    std::fs::write(
        site.join("pages/about.tsx"),
        format!(
            "import '../shared/setup';\nexport {{ metadata }} from '../shared/meta';\n{}\n{}\nexport default function About() {{ return ({}); }}\n",
            decoys[0], decoys[1], decoys[2]
        ),
    )
    .unwrap();
    let moved = temp.path().join("site-moved");
    let (ok, report) = migrate(&site, &moved, &["--space", "spc_migrate_test"]);
    assert!(ok, "{report:#}");
    let about = std::fs::read_to_string(moved.join("pages/about/page.tsx")).unwrap();
    assert!(about.contains("import '../../first/shared/setup';"), "{about}");
    // A re-export moves with its module too.
    assert!(
        about.contains("export { metadata } from '../../first/shared/meta';"),
        "{about}"
    );
    assert!(moved.join("first/shared/setup.ts").is_file());
    for decoy in decoys {
        assert!(about.contains(decoy), "rewrote non-import text {decoy:?}: {about}");
    }
    // Interactive starters keep a pointer per page saying what to port.
    let (ok, refused) = migrate(
        &corpus("starter-todo"),
        &temp.path().join("todo"),
        &["--users", "--space", "s", "--dry-run"],
    );
    assert!(!ok);
    let errors = refused["errors"].as_array().unwrap();
    // Two interactive pages, and the client/ app 0.8 built alongside them, which nothing carries.
    let codes: Vec<&str> = errors.iter().map(|e| e["code"].as_str().unwrap()).collect();
    assert_eq!(
        codes,
        ["Z08_PAGE_INTERACTIVE", "Z08_PAGE_INTERACTIVE", "Z08_OMITTED_CLIENT"]
    );
    assert_eq!(errors[0]["pointer"], "/pages/index.tsx");
    let reason = errors[0]["reason"].as_str().unwrap();
    assert!(
        reason.contains("live queries") && reason.contains("mutations") && reason.contains("docs/pages.md"),
        "{reason}"
    );
}

#[test]
fn the_configured_server_entry_is_read_from_sf_jsonc() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("source");
    std::fs::create_dir_all(root.join("server")).unwrap();
    std::fs::write(
        root.join("sf.jsonc"),
        "{\n  // the 0.8 runtime block\n  \"runtime\": { \"kind\": \"first\", \"server\": \"server/app.ts\", },\n}\n",
    )
    .unwrap();
    std::fs::write(
        root.join("server/app.ts"),
        "import { capsule, query } from '@spacefast/zero/server'; export default capsule({ name: 'Entry App', queries: { hi: query(async () => 'hi') } });",
    )
    .unwrap();
    let out = temp.path().join("candidate");
    let (ok, report) = migrate(&root, &out, &[]);
    assert!(ok, "{report:#}");
    assert!(out.join("first/server/index.ts").is_file());
    assert!(!out.join("first/server/app.ts").exists());
    build(&out);
    // JSX in a server entry is ImageResponse; v2 server code has no renderer for it.
    let (ok, refused) = migrate(&corpus("compile-notes"), &temp.path().join("notes"), &["--dry-run"]);
    assert!(!ok);
    assert!(
        refused["errors"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("JSX on the server")
    );
}

#[test]
fn query_names_map_one_to_one_and_nested_pages_keep_imports() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("source");
    project(
        &root,
        r#"{endpoints:{note:endpoint({method:"GET",path:"/api/notes/:id"},(_ctx, req)=>text(req.params.id)),count:endpoint({method:"GET",path:"/api/notes/count"},()=>text("count")),tag:endpoint({method:"GET",path:"/api/tag"},(_ctx, req)=>text(req.query.get("user.id") ?? ""))}}"#,
    );
    let source = std::fs::read_to_string(root.join("server/index.ts"))
        .unwrap()
        .replace("import { capsule }", "import { capsule, endpoint, text }");
    std::fs::write(root.join("server/index.ts"), source).unwrap();
    std::fs::create_dir_all(root.join("pages/docs")).unwrap();
    std::fs::write(root.join("pages/docs/data.ts"), "export const title = \"Docs\";\n").unwrap();
    std::fs::write(
        root.join("pages/docs/index.tsx"),
        "import { title } from \"./data\";\nexport default function Docs() { return <h1>{title}</h1>; }\n",
    )
    .unwrap();
    std::fs::write(
        root.join("pages/docs/guide.tsx"),
        "import { title } from \"./data\";\nexport default function Guide() { return <h1>{title} guide</h1>; }\n",
    )
    .unwrap();
    std::fs::write(
        root.join("pages/keys.tsx"),
        "export default function Keys() { return <input onKeyDown={() => undefined} />; }\n",
    )
    .unwrap();
    let out = temp.path().join("candidate");
    let (ok, report) = migrate(&root, &out, &["--dry-run"]);
    assert!(!ok);
    assert_eq!(report["errors"].as_array().unwrap().len(), 1, "{report:#}");
    assert_eq!(report["errors"][0]["pointer"], "/pages/keys.tsx");
    std::fs::remove_file(root.join("pages/keys.tsx")).unwrap();
    let (ok, report) = migrate(&root, &out, &[]);
    assert!(ok, "{report:#}");
    let config = std::fs::read_to_string(out.join("first/server/index.ts")).unwrap();
    // RouteQuery keeps URLSearchParams names byte for byte, so `user.id` passes through unchanged.
    assert!(config.contains("req.query.get(\"user.id\")"), "{config}");
    assert!(
        std::fs::read_to_string(out.join("pages/docs/page.tsx"))
            .unwrap()
            .contains("from \"./data\"")
    );
    assert!(
        std::fs::read_to_string(out.join("pages/docs/guide/page.tsx"))
            .unwrap()
            .contains("from \"../data\"")
    );
    assert!(out.join("pages/docs/data.ts").is_file());
}

/// Runs each named action of a built app in PHP with `inputs`, under `env`, and returns the results.
fn run_actions(project: &Path, env: &[(&str, &str)], calls: &Value) -> Value {
    let content = project.join("first/dist/wp-content/plugins");
    let app = std::fs::read_dir(&content)
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.is_dir() && p.file_name().unwrap().to_string_lossy().starts_with("first-app-"))
        .unwrap()
        .join("first/app");
    let script = r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$out = [];
foreach (json_decode(file_get_contents('php://stdin'), true) as [$name, $input, $env]) {
  \First\Env::isolate($env);
  $fn = '\\FirstApp\\' . $schema['actions'][$name]['handler'];
  try { $out[] = ['data' => $fn(\First\Seam::toJs($input, ['type' => 'json']), \First\Seam::ctx(['user' => null]))]; }
  catch (\First\HttpError $e) { $out[] = ['error' => $e->errorCode]; }
}
echo \First\Js::jsonStringify($out);
"#;
    let env: serde_json::Map<String, Value> = env.iter().map(|(k, v)| (k.to_string(), Value::from(*v))).collect();
    let calls: Vec<Value> = calls
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            let mut call = c.as_array().unwrap().clone();
            if call.len() == 2 {
                call.push(Value::Object(env.clone()));
            }
            Value::Array(call)
        })
        .collect();
    let mut child = Command::new("php")
        .args(["-r", script])
        .arg(content.join("first-runtime/first/bootstrap.php"))
        .arg(app)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    use std::io::Write as _;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(Value::Array(calls).to_string().as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
}

#[test]
fn the_global_fetch_needs_no_rewrite() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("fetch");
    let (ok, report) = migrate(&fixture("fetch"), &out, &[]);
    assert!(ok, "{report:#}");
    // Building runs the v2 compiler, which refuses an unawaited body read: both endpoints await.
    build(&out);
}

/// ctx.crypto through node:crypto gives the original runtime's output on every recorded vector
/// (tests/php/crypto-parity), with named keys trimmed and a missing one refused.
#[test]
fn ctx_crypto_maps_to_node_crypto_with_the_original_results() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("crypto");
    let (ok, report) = migrate(&fixture("crypto"), &out, &[]);
    assert!(ok, "{report:#}");
    build(&out);
    let parity = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/crypto-parity");
    let read = |f: &str| -> Value { serde_json::from_str(&std::fs::read_to_string(parity.join(f)).unwrap()).unwrap() };
    let expected = read("expected.json");
    let trim = |k: &str| k.trim().to_string();
    let inline: Vec<Value> = read("cases.json")
        .as_array()
        .unwrap()
        .iter()
        .map(|c| serde_json::json!(["vector", {"key": trim(c[0].as_str().unwrap()), "data": c[1]}, {}]))
        .collect();
    let named: Vec<Value> = read("named.json")
        .as_array()
        .unwrap()
        .iter()
        .map(|c| serde_json::json!(["named", {"key": c[0], "data": c[1]}, {"K": c[0]}]))
        .collect();
    let data = |v: Value| -> Vec<Value> { v.as_array().unwrap().iter().map(|r| r["data"].clone()).collect() };
    // 0.8 compared the untrimmed key with the data; the inline vector passes the trimmed key to
    // the MAC only, so compare its digest and MAC columns and take the comparison from `named`.
    let inline_actual = data(run_actions(&out, &[], &Value::Array(inline.clone())));
    let inline_expected = expected["inline"].as_array().unwrap();
    assert_eq!(inline_actual.len(), 201);
    for (i, (actual, want)) in inline_actual.iter().zip(inline_expected).enumerate() {
        assert_eq!(actual[0], want[0], "inline case {i}");
        assert_eq!(actual[1], want[1], "inline case {i}");
    }
    let named_actual = data(run_actions(&out, &[], &Value::Array(named)));
    assert_eq!(named_actual.len(), 251);
    assert_eq!(Value::Array(named_actual), expected["named"], "named keys");
    let refused = run_actions(
        &out,
        &[],
        &serde_json::json!([["named", {"key": "k", "data": "d"}, {}], ["named", {"key": "k", "data": "d"}, {"K": " \n"}]]),
    );
    assert_eq!(
        refused,
        serde_json::json!([{"error": "crypto_key_unavailable"}, {"error": "crypto_key_unavailable"}])
    );
    // A webhook endpoint's ctx.crypto is a route, not an action; it gets the mapping entry too.
    let root = temp.path().join("webhook");
    project(
        &root,
        r#"{endpoints:{hook:endpoint({method:"POST",path:"/hooks/in"},async (ctx, request) => text(await ctx.crypto.sha256(await request.text())))}}"#,
    );
    let source = std::fs::read_to_string(root.join("server/index.ts"))
        .unwrap()
        .replace("import { capsule }", "import { capsule, endpoint, text }");
    std::fs::write(root.join("server/index.ts"), source).unwrap();
    let (ok, report) = migrate(&root, &temp.path().join("webhook-out"), &["--dry-run"]);
    assert!(ok, "{report:#}");
    assert!(
        report["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["outcome"] == "mapped"
                && e["reason"]
                    .as_str()
                    .unwrap()
                    .starts_with("ctx.crypto becomes node:crypto")),
        "{report:#}"
    );
    // `{ value: ctx.env.SECRET }` keeps the untrimmed value, unlike the named key "K".
    let key = " k \n";
    let env_key = run_actions(
        &out,
        &[],
        &serde_json::json!([
            ["inlineEnv", {"data": "d"}, {"SECRET": key}],
            ["vector", {"key": key, "data": "d"}, {}],
            ["named", {"key": key, "data": "d"}, {"K": key}],
        ]),
    );
    assert_eq!(env_key[0]["data"], env_key[1]["data"][1], "{env_key}");
    assert_ne!(env_key[0]["data"], env_key[2]["data"][1], "{env_key}");
    let root = temp.path().join("jwt");
    project(
        &root,
        r#"{actions:{token:action(async (ctx) => ctx.jwt.sign({ key: "K", kid: "k1", claims: {} })),check:action(async (ctx, content: string) => (await ctx.spam.check({ content })).spam)}}"#,
    );
    let source = std::fs::read_to_string(root.join("server/index.ts"))
        .unwrap()
        .replace("import { capsule }", "import { action, capsule }");
    std::fs::write(root.join("server/index.ts"), source).unwrap();
    let (ok, refused) = migrate(&root, &temp.path().join("no"), &["--dry-run"]);
    assert!(!ok);
    // Each service with no First counterpart says what is missing and what to do instead.
    let errors: Vec<(&str, &str, &str)> = refused["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["pointer"].as_str().unwrap(),
                e["code"].as_str().unwrap(),
                e["reason"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(errors.len(), 2, "{refused:#}");
    let reason = |pointer: &str| errors.iter().find(|e| e.0 == pointer).map(|e| (e.1, e.2)).unwrap();
    let (code, jwt) = reason("/actions/token/ctx/jwt");
    assert_eq!(code, "Z08_CTX_SERVICE");
    assert!(jwt.contains("Ed25519") && jwt.contains("owner ruling"), "{jwt}");
    let (code, spam) = reason("/actions/check/ctx/spam");
    assert_eq!(code, "Z08_CTX_SERVICE");
    assert!(spam.contains("Akismet") && spam.contains("owner ruling"), "{spam}");
}

#[test]
fn ctx_email_send_maps_to_mail_send_and_queries_still_refuse() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("email");
    let (ok, report) = migrate(&fixture("email"), &out, &["--space", "spc_migrate_test"]);
    assert!(ok, "{report:#}");
    assert!(report["entries"].as_array().unwrap().iter().any(|e| {
        e["outcome"] == "review"
            && e["reason"]
                .as_str()
                .unwrap()
                .starts_with("ctx.email.send becomes mail.send")
    }));
    build(&out);
    let root = temp.path().join("query");
    project(
        &root,
        r#"{queries:{q:query(async (ctx) => ctx.email.send({ from: "a@example.test", to: "b@example.test", subject: "s", text: "t" }))}}"#,
    );
    let source = std::fs::read_to_string(root.join("server/index.ts"))
        .unwrap()
        .replace("import { capsule }", "import { capsule, query }");
    std::fs::write(root.join("server/index.ts"), source).unwrap();
    let (ok, refused) = migrate(&root, &temp.path().join("no"), &["--dry-run"]);
    assert!(!ok);
    assert_eq!(refused["errors"][0]["pointer"], "/queries/q/ctx/email");
    // A send returned from inside control flow was awaited by 0.8 as well; it maps.
    let root = temp.path().join("nested");
    project(
        &root,
        r#"{mutations:{m:mutation(async (ctx, enabled: boolean) => { if (enabled) { return ctx.email.send({ from: "a@example.test", to: "b@example.test", subject: "s", text: "t" }); } return false; })}}"#,
    );
    let source = std::fs::read_to_string(root.join("server/index.ts"))
        .unwrap()
        .replace("import { capsule }", "import { capsule, mutation }");
    std::fs::write(root.join("server/index.ts"), source).unwrap();
    let (ok, report) = migrate(&root, &temp.path().join("nested-out"), &[]);
    assert!(ok, "{report:#}");
    build(&temp.path().join("nested-out"));
    // A send left floating inside a nested function is still refused.
    let root = temp.path().join("floating");
    project(
        &root,
        r#"{mutations:{m:mutation(async (ctx) => { [1].forEach(() => { ctx.email.send({ from: "a@example.test", to: "b@example.test", subject: "s", text: "t" }); }); return true; })}}"#,
    );
    let source = std::fs::read_to_string(root.join("server/index.ts"))
        .unwrap()
        .replace("import { capsule }", "import { capsule, mutation }");
    std::fs::write(root.join("server/index.ts"), source).unwrap();
    let (ok, refused) = migrate(&root, &temp.path().join("floating-out"), &["--dry-run"]);
    assert!(!ok);
    assert_eq!(refused["errors"][0]["pointer"], "/mutations/m/ctx/email");
}

/// A run from a stored 0.8 finalize payload (`--manifest`), as a production census drives it.
fn migrate_manifest(manifest: &Path, source: Option<&Path>, out: &Path) -> (bool, Value) {
    let mut command = Command::new(env!("CARGO_BIN_EXE_first"));
    command
        .args(["migrate", "app", "--from", "zero-0.8", "--manifest"])
        .arg(manifest);
    if let Some(source) = source {
        command.arg(source);
    }
    let output = command
        .arg("--out")
        .arg(out)
        .args(["--dry-run", "--space", "spc_migrate_test", "--users"])
        .output()
        .unwrap();
    let report = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&output.stderr)));
    (output.status.success(), report)
}

#[test]
fn a_finalize_manifest_converts_with_its_published_source_and_refuses_without_it() {
    let temp = tempfile::tempdir().unwrap();
    let manifest = fixture("manifest/finalize.json");
    let errors = |report: &Value| -> Vec<(String, String)> {
        report["errors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                (
                    e["pointer"].as_str().unwrap().into(),
                    e["reason"].as_str().unwrap().into(),
                )
            })
            .collect()
    };
    // Only the manifest: the bundled JavaScript is not the authored TypeScript, so never accepted.
    let (ok, report) = migrate_manifest(&manifest, None, &temp.path().join("a"));
    assert!(!ok);
    assert_eq!(report["status"], "refused");
    let only = errors(&report);
    assert_eq!(only.len(), 1, "{only:?}");
    assert_eq!(only[0].0, "/source");
    assert!(only[0].1.starts_with("source not recoverable"));

    // The source at the published commit: every recorded hash matches, so it converts.
    let source = temp.path().join("source");
    std::fs::create_dir_all(source.join("server")).unwrap();
    std::fs::create_dir_all(source.join("client")).unwrap();
    std::fs::copy(fixture("endpoints/server/index.ts"), source.join("server/index.ts")).unwrap();
    std::fs::write(
        source.join("client/main.tsx"),
        "export default function App() { return null; }\n",
    )
    .unwrap();
    // The publish built client/main.tsx into the Space's browser app, which the candidate does
    // not carry over: the server converts, and the client is the one omission.
    let (ok, report) = migrate_manifest(&manifest, Some(&source), &temp.path().join("b"));
    assert!(!ok);
    let codes: Vec<&str> = report["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["code"].as_str().unwrap())
        .collect();
    assert_eq!(codes, ["Z08_OMITTED_CLIENT"], "{report:#}");
    assert_eq!(report["errors"][0]["file"], "client/main.tsx");

    // An unrecorded page was not part of the publish, so it never reaches the candidate. An
    // unrecorded config is refused: 0.8 applied sf.jsonc and theme.json to the Space, a real
    // manifest never records them, and the candidate can't check they are the published ones.
    std::fs::create_dir_all(source.join("pages")).unwrap();
    std::fs::write(
        source.join("pages/added.tsx"),
        "export default function Added() { return <p>later</p>; }\n",
    )
    .unwrap();
    std::fs::write(
        source.join("sf.jsonc"),
        r#"{"runtime":{"server":"server/other.ts"},"redirects":[{"source":"/a","destination":"/b"}],"headers":[],"access":{"mode":"team"}}"#,
    )
    .unwrap();
    std::fs::write(source.join("theme.json"), r#"{"version":3}"#).unwrap();
    // The publish without its client, so the config is the only thing left to refuse.
    let mut server_only: Value = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
    let recorded = &mut server_only["artifact"]["sourceManifest"];
    recorded["files"]
        .as_array_mut()
        .unwrap()
        .retain(|f| f["path"] != "client/main.tsx");
    recorded["entries"].as_object_mut().unwrap().remove("client");
    let server_only_path = temp.path().join("server-only.json");
    std::fs::write(&server_only_path, server_only.to_string()).unwrap();
    let out = temp.path().join("b2");
    let output = Command::new(env!("CARGO_BIN_EXE_first"))
        .args(["migrate", "app", "--from", "zero-0.8", "--manifest"])
        .arg(&server_only_path)
        .arg(&source)
        .arg("--out")
        .arg(&out)
        .args(["--space", "spc_migrate_test", "--users"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let written: Value = serde_json::from_slice(&output.stdout).unwrap();
    let refused: Vec<(&str, &str)> = written["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["code"].as_str().unwrap(), e["file"].as_str().unwrap()))
        .collect();
    assert_eq!(
        refused,
        [
            ("Z08_OMITTED_UNVERIFIED_CONFIG", "sf.jsonc"),
            ("Z08_OMITTED_UNVERIFIED_CONFIG", "theme.json")
        ],
        "{written:#}"
    );
    assert!(!out.exists());
    std::fs::remove_file(source.join("sf.jsonc")).unwrap();
    std::fs::remove_file(source.join("theme.json")).unwrap();
    // Without them the server converts, and the later page still isn't part of it.
    let output = Command::new(env!("CARGO_BIN_EXE_first"))
        .args(["migrate", "app", "--from", "zero-0.8", "--manifest"])
        .arg(&server_only_path)
        .arg(&source)
        .arg("--out")
        .arg(&out)
        .args(["--space", "spc_migrate_test", "--users"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stdout));
    assert!(out.join("first/server/index.ts").is_file());
    assert!(!out.join("pages").exists(), "an unrecorded page reached the candidate");
    std::fs::remove_dir_all(source.join("pages")).unwrap();

    // A real finalize manifest records the capsule's source, never the static files served beside
    // it, so those can't be checked against the publish: each is refused at its file, neither
    // carried unchecked nor dropped. OS metadata is still skipped.
    let png: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe];
    std::fs::create_dir_all(source.join("assets")).unwrap();
    std::fs::create_dir_all(source.join("public")).unwrap();
    std::fs::write(source.join("public/logo.png"), png).unwrap();
    std::fs::write(
        source.join("index.html"),
        "<!doctype html><script src=/assets/app.js></script>",
    )
    .unwrap();
    std::fs::write(source.join("assets/app.js"), "document.title = 'x';\n").unwrap();
    std::fs::write(source.join(".DS_Store"), png).unwrap();
    let (ok, report) = migrate_manifest(&manifest, Some(&source), &temp.path().join("b4"));
    assert!(!ok);
    let refused: Vec<(&str, &str)> = report["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["code"].as_str().unwrap(), e["file"].as_str().unwrap()))
        .collect();
    assert_eq!(
        refused,
        [
            ("Z08_OMITTED_CLIENT", "client/main.tsx"),
            ("Z08_OMITTED_UNVERIFIED", "assets/app.js"),
            ("Z08_OMITTED_UNVERIFIED", "index.html"),
            ("Z08_OMITTED_UNVERIFIED", "public/logo.png"),
        ],
        "{report:#}"
    );
    for path in ["public", "assets"] {
        std::fs::remove_dir_all(source.join(path)).unwrap();
    }
    std::fs::remove_file(source.join("index.html")).unwrap();
    std::fs::remove_file(source.join(".DS_Store")).unwrap();

    // A recorded sf.jsonc that names another entry than the publish compiled is refused.
    let mut renamed: Value = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
    let config = r#"{"runtime":{"server":"server/main.ts"}}"#;
    std::fs::write(source.join("sf.jsonc"), config).unwrap();
    renamed["artifact"]["sourceManifest"]["files"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({"path": "sf.jsonc", "size": config.len(), "sha256": sha2::Sha256::digest(config.as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>()}));
    let renamed_path = temp.path().join("renamed.json");
    std::fs::write(&renamed_path, renamed.to_string()).unwrap();
    let (ok, report) = migrate_manifest(&renamed_path, Some(&source), &temp.path().join("b3"));
    assert!(!ok);
    assert_eq!(report["errors"][0]["pointer"], "/source");
    assert!(
        report["errors"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("the publish compiled server/index.ts"),
        "{report:#}"
    );
    std::fs::remove_file(source.join("sf.jsonc")).unwrap();

    // A later edit is not the published version.
    std::fs::write(source.join("server/index.ts"), "// edited\n").unwrap();
    let (ok, report) = migrate_manifest(&manifest, Some(&source), &temp.path().join("c"));
    assert!(!ok);
    assert_eq!(
        errors(&report),
        [(
            "/source".to_string(),
            "source differs from the published version: server/index.ts (changed)".to_string()
        )]
    );

    // What the manifest alone decides is refused with pointers, ahead of the source refusal.
    let mut payload: Value = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
    let artifact = &mut payload["artifact"];
    artifact["server"]["endpoints"].as_array_mut().unwrap().extend([
        serde_json::json!({"mode": "read", "method": "GET", "path": "/wp-admin/x"}),
        serde_json::json!({"mode": "write", "method": "GET", "path": "/hit"}),
    ]);
    artifact["server"]["sockets"] = serde_json::json!(["chat"]);
    artifact["pages"] = serde_json::json!([
        {"id": "pg_about", "file": "pages/about.md", "path": "/about", "render": "document", "params": [], "bindingId": "bnd_about"}
    ]);
    let edited = temp.path().join("refusing.json");
    std::fs::write(&edited, payload.to_string()).unwrap();
    let (ok, report) = migrate_manifest(&edited, None, &temp.path().join("d"));
    assert!(!ok);
    let pointers: Vec<_> = errors(&report).into_iter().map(|(p, _)| p).collect();
    assert_eq!(
        pointers,
        [
            "/sockets/chat",
            "/endpoints/GET ~1wp-admin~1x/path",
            // A writing GET is decided by its body (does it read the visitor?), which needs the source.
            "/pages/0",
            "/source"
        ]
    );

    // Not a 0.8 artifact at all.
    std::fs::write(temp.path().join("other.json"), r#"{"artifact":{"format":"other"}}"#).unwrap();
    let (ok, report) = migrate_manifest(&temp.path().join("other.json"), None, &temp.path().join("e"));
    assert!(!ok);
    assert_eq!(report["errors"][0]["pointer"], "/artifact/format");
}

/// Language constructs live 0.8 apps use (first#138) convert and build. Each construct also has a
/// Node/PHP differential corpus in tests/differential/language.
#[test]
fn language_constructs_convert_and_build() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("language");
    let (ok, written) = migrate(&fixture("language"), &out, &["--space", "spc_migrate_test"]);
    assert!(ok, "{written:#}");
    assert_eq!(written["status"], "written");
    build(&out);
}

/// 0.8 called `handler(ctx, ...args)` with the client's positional arguments. Default, rest and
/// destructured parameters become named v2 inputs, and the converted actions answer each call the
/// way the 0.8 handler did (the expected values are Node's results for the same calls).
#[test]
fn default_rest_and_destructured_handler_parameters_become_inputs() {
    let temp = tempfile::tempdir().unwrap();
    let capsule = temp.path().join("capsule");
    project(
        &capsule,
        r#"{ name: "params", queries: {
    page: query(async (ctx, limit: number = 10, label: string = "all") => [limit, label]),
    sum: query(async (ctx, base: number, ...rest: number[]) => rest.reduce((a, b) => a + b, base)),
    tags: query(async (ctx, ...tags: string[]) => tags.join(",")),
    find: query(async (ctx, { status, limit = 5 }: { status: string; limit?: number }) => `${status}:${limit}`),
    pair: query(async (ctx, [a, b]: [string, number], extra: string = "e") => `${a}${b}${extra}`),
    opts: query(async (ctx, { sort = "asc" }: { sort?: string } = {}) => sort),
  } }"#,
    );
    let index = capsule.join("server/index.ts");
    let text = std::fs::read_to_string(&index)
        .unwrap()
        .replace("import { capsule }", "import { capsule, query }");
    std::fs::write(&index, text).unwrap();
    let out = temp.path().join("out");
    let (ok, report) = migrate(&capsule, &out, &[]);
    assert!(ok, "{report:#}");
    build(&out);
    let calls = serde_json::json!([
        ["page", {}], ["page", {"limit": 3}], ["sum", {"base": 1, "rest": [2, 3]}], ["sum", {"base": 1}],
        ["tags", {"tags": ["a", "b"]}], ["tags", {}], ["find", {"arg1": {"status": "open"}}],
        ["find", {"arg1": {"status": "x", "limit": 2}}], ["pair", {"arg1": ["a", 1]}], ["opts", {}],
        ["opts", {"arg1": {"sort": "desc"}}]
    ]);
    let run = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/wp.php"))
        .arg("eval")
        .arg(out.join("first/dist/wp-content"))
        .arg(r#"$r = []; foreach ($arg as [$n, $in]) { $r[] = json_decode($app->cli(['action', $n, json_encode((object) $in)])[1], true); } echo json_encode($r), "\n";"#)
        .arg(calls.to_string())
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&run.stdout);
    let got: Value =
        serde_json::from_str(stdout.lines().next_back().unwrap_or("")).unwrap_or_else(|_| panic!("{stdout}"));
    let want = serde_json::json!([
        {"data": [10, "all"]}, {"data": [3, "all"]}, {"data": 6}, {"data": 1}, {"data": "a,b"}, {"data": ""},
        {"data": "open:5"}, {"data": "x:2"}, {"data": "a1e"}, {"data": "asc"}, {"data": "desc"}
    ]);
    assert_eq!(got, want);

    // A missing argument and an explicit null both arrive as a null v2 input, so a default on a
    // nullable parameter can't be preserved and is refused with a pointer.
    let nullable = temp.path().join("nullable");
    project(
        &nullable,
        r#"{ name: "params", queries: { page: query(async (ctx, label: string | null = "all") => label) } }"#,
    );
    let index = nullable.join("server/index.ts");
    let text = std::fs::read_to_string(&index)
        .unwrap()
        .replace("import { capsule }", "import { capsule, query }");
    std::fs::write(&index, text).unwrap();
    let (ok, refused) = migrate(&nullable, &temp.path().join("nullable-out"), &["--dry-run"]);
    assert!(!ok);
    assert_eq!(refused["errors"][0]["pointer"], "/queries/page");
    assert!(
        refused["errors"][0]["reason"].as_str().unwrap().contains("allows null"),
        "{refused:#}"
    );

    // A default typed by a named alias may allow null, and a default that reads the context has
    // no context binding in the generated handler: both need a manual port.
    for (case, capsule, reason) in [
        (
            "alias",
            r#"{ name: "params", queries: { page: query(async (ctx, label: Label = "all") => label) } }"#,
            "allows null",
        ),
        (
            "context",
            r#"{ name: "params", queries: { page: query(async (ctx, mine: boolean = ctx.auth.isSignedIn) => mine) } }"#,
            "reads the context",
        ),
    ] {
        let root = temp.path().join(case);
        project(&root, capsule);
        let index = root.join("server/index.ts");
        let text = std::fs::read_to_string(&index).unwrap().replace(
            "import { capsule }",
            "type Label = string | null;\nimport { capsule, query }",
        );
        std::fs::write(&index, text).unwrap();
        let (ok, refused) = migrate(&root, &temp.path().join(format!("{case}-out")), &["--dry-run"]);
        assert!(!ok, "{capsule}");
        assert!(
            refused["errors"][0]["reason"].as_str().unwrap().contains(reason),
            "{refused:#}"
        );
    }

    // The context's name in a string or as a property key isn't a read of the context.
    for (case, capsule) in [
        (
            "string",
            r#"{ name: "params", queries: { page: query(async (ctx, label: string = "ctx") => label) } }"#,
        ),
        (
            "key",
            r#"{ name: "params", queries: { page: query(async (ctx, { ctx: value = "v" }: { ctx?: string } = {}) => value) } }"#,
        ),
    ] {
        let root = temp.path().join(case);
        project(&root, capsule);
        let index = root.join("server/index.ts");
        let text = std::fs::read_to_string(&index)
            .unwrap()
            .replace("import { capsule }", "import { capsule, query }");
        std::fs::write(&index, text).unwrap();
        let (ok, report) = migrate(&root, &temp.path().join(format!("{case}-out")), &["--dry-run"]);
        assert!(ok, "{capsule}: {report:#}");
    }
}

/// The zero.css Zero 0.8 compiled for the client-app fixture (fixtures README).
fn styles() -> &'static str {
    concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/app-migrate/client-app-styles/zero.css"
    )
}

/// A 0.8 client app without pages converts: actions and tables into first.config.ts, the client
/// into public/, and the candidate checks with no diagnostics.
#[test]
fn a_client_app_without_pages_becomes_public_files_and_checks_clean() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("client-app");
    let (ok, report) = migrate(
        &fixture("client-app"),
        &out,
        &["--space", "spc_migrate_test", "--users", "--zero-css", styles()],
    );
    assert!(ok, "{report:#}");
    for file in [
        "first.config.ts",
        "public/zero.css",
        "public/index.html",
        "public/first/main.js",
        "public/first/client.js",
        "public/first/handlers.js",
        "public/app/client/index.js",
        "public/app/client/Shelf.js",
        "public/app/shared/format.js",
        "public/client/styles.css",
    ] {
        assert!(out.join(file).is_file(), "{file}");
    }
    // 0.8's generated stylesheet comes along byte for byte, linked before the authored one as 0.8's
    // shell linked it.
    assert_eq!(
        std::fs::read(out.join("public/zero.css")).unwrap(),
        std::fs::read(styles()).unwrap()
    );
    let shell = std::fs::read_to_string(out.join("public/index.html")).unwrap();
    let links: Vec<&str> = shell
        .lines()
        .filter_map(|l| l.trim().strip_prefix("<link rel=\"stylesheet\" href=\""))
        .collect();
    assert_eq!(links, ["./zero.css\">", "./client/styles.css\">"], "{shell}");
    // Without it the app is refused at the client entry, never published unstyled.
    let (ok, unstyled) = migrate(
        &fixture("client-app"),
        &temp.path().join("unstyled"),
        &["--space", "spc_migrate_test", "--users", "--dry-run"],
    );
    assert!(!ok);
    let errors: Vec<(&str, &str, u64)> = unstyled["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["code"].as_str().unwrap(),
                e["file"].as_str().unwrap(),
                e["line"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(errors, [("Z08_CLIENT_STYLES", "client/index.tsx", 1)], "{unstyled:#}");
    let review = report["entries"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["pointer"] == "/client/index.tsx" && e["outcome"] == "review");
    assert!(review, "{report:#}");
    // No client file is dropped: every module reaches public/app/ and every stylesheet public/.
    for source in walk(&fixture("client-app/client"))
        .into_iter()
        .chain(walk(&fixture("client-app/shared")))
    {
        let relative = source.strip_prefix(fixture("client-app")).unwrap();
        let emitted = if relative.extension().is_some_and(|e| e == "css") {
            out.join("public").join(relative)
        } else {
            out.join("public/app").join(relative.with_extension("js"))
        };
        assert!(emitted.is_file(), "{} was dropped", relative.display());
    }
    let checked = Command::new(env!("CARGO_BIN_EXE_first"))
        .args(["check", "--json"])
        .arg(&out)
        .output()
        .unwrap();
    let checked: Value = serde_json::from_slice(&checked.stdout).unwrap();
    assert_eq!(checked["ok"], true, "{checked}");
    assert_eq!(checked["diagnostics"].as_array().unwrap().len(), 0, "{checked}");
    // The candidate serves the client from public/app/, public/first/ and its stylesheet folders
    // (here public/client/), where 0.8 served nothing of the app, so a 0.8 redirect under them
    // would now break it: refused, not carried.
    let moved = temp.path().join("client-app-redirect");
    copy_tree(&fixture("client-app"), &moved);
    let config = std::fs::read_to_string(moved.join("sf.jsonc")).unwrap().replacen(
        "\"name\": \"Shelf Notes\",",
        "\"name\": \"Shelf Notes\",\n  \"redirects\": [{ \"source\": \"/app/*\", \"destination\": \"/moved\", \"status\": 301 }, { \"source\": \"/client/*\", \"destination\": \"/moved\", \"status\": 301 }],",
        1,
    );
    std::fs::write(moved.join("sf.jsonc"), config).unwrap();
    let (ok, refused) = migrate(
        &moved,
        &temp.path().join("client-app-redirect-out"),
        &[
            "--space",
            "spc_migrate_test",
            "--users",
            "--dry-run",
            "--zero-css",
            styles(),
        ],
    );
    assert!(!ok);
    let errors: Vec<(&str, &str)> = refused["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["code"].as_str().unwrap(), e["pointer"].as_str().unwrap()))
        .collect();
    assert_eq!(errors, [("Z08_OMITTED_CONFIG", "/sf.jsonc/redirects")], "{refused:#}");
    // The refusal names the first rule that blocks the key.
    let reason = refused["errors"][0]["reason"].as_str().unwrap();
    assert!(reason.contains("the rule on `/app/*`"), "{refused:#}");
}

/// The bridge posts a 0.8 positional call as the input the generated v2 action declares, and the
/// action answers it: the browser modules run in Node, the action in the built PHP plugin.
#[test]
fn the_client_bridge_calls_the_generated_v2_action() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("client-app");
    let (ok, report) = migrate(
        &fixture("client-app"),
        &out,
        &["--space", "spc_migrate_test", "--users", "--zero-css", styles()],
    );
    assert!(ok, "{report:#}");
    // 0.8's `useAction("banner")("ab", 3)`, through the converted module, against a recording fetch.
    let script = r#"
const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url, method: init.method, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ data: "ABABAB" }), { status: 200 });
};
const bridge = await import(process.argv[1]);
const result = await bridge.run("banner", ["ab", 3]);
console.log(JSON.stringify({ sent, result }));
"#;
    let node = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .arg(out.join("public/first/client.js"))
        .output()
        .expect("node is required");
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let ran: Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(ran["sent"][0]["url"], "/wp-json/first/v1/actions/banner", "{ran}");
    assert_eq!(ran["sent"][0]["method"], "POST");
    assert_eq!(ran["result"], "ABABAB");
    // The body the bridge sent is exactly what the generated action takes.
    build(&out);
    let results = run_actions(
        &out,
        &[],
        &serde_json::json!([["banner", ran["sent"][0]["body"].clone()]]),
    );
    assert_eq!(results, serde_json::json!([{ "data": "ABABAB" }]));
}

/// What the bridge can't carry is refused with a registered Z08_CLIENT_* code at the import.
#[test]
fn a_client_import_without_a_bridge_refuses_with_a_located_code() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("source");
    copy_dir(&fixture("client-app"), &root);
    let shelf = root.join("client/Shelf.tsx");
    let text = std::fs::read_to_string(&shelf).unwrap();
    std::fs::write(
        &shelf,
        text.replace(
            "import { useMutation, useQuery } from \"@spacefast/zero/client\";",
            "import { storage, useMutation, useQuery } from \"@spacefast/zero/client\";\nimport { Card } from \"@spacefast/zero/kit\";",
        ),
    )
    .unwrap();
    let (ok, report) = migrate(
        &root,
        &temp.path().join("out"),
        &["--space", "s", "--users", "--dry-run", "--zero-css", styles()],
    );
    assert!(!ok);
    let errors = report["errors"].as_array().unwrap();
    let codes: Vec<(&str, &str, u64, u64)> = errors
        .iter()
        .map(|e| {
            (
                e["code"].as_str().unwrap(),
                e["file"].as_str().unwrap(),
                e["line"].as_u64().unwrap(),
                e["column"].as_u64().unwrap(),
            )
        })
        .collect();
    // Each refusal points at its import's module specifier.
    let edited = std::fs::read_to_string(&shelf).unwrap();
    let column = |line: usize| edited.lines().nth(line - 1).unwrap().find('"').unwrap() as u64 + 1;
    assert_eq!(
        codes,
        [
            ("Z08_CLIENT_STORAGE", "client/Shelf.tsx", 2, column(2)),
            ("Z08_CLIENT_KIT", "client/Shelf.tsx", 3, column(3))
        ],
        "{report:#}"
    );
    for e in errors {
        assert_eq!(e["pointer"], "/client/Shelf.tsx");
        assert!(!e["fix"].as_str().unwrap().is_empty());
    }
    // An existing public/ (where the client goes) and an unreadable module have their own codes.
    std::fs::write(&shelf, text).unwrap();
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(root.join("public/robots.txt"), "").unwrap();
    std::fs::write(root.join("client/Feed.tsx"), [0xff, 0xfe, 0x00]).unwrap();
    let (ok, report) = migrate(
        &root,
        &temp.path().join("out2"),
        &["--space", "s", "--users", "--dry-run", "--zero-css", styles()],
    );
    assert!(!ok);
    let codes: Vec<(&str, &str)> = report["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["code"].as_str().unwrap(), e["file"].as_str().unwrap()))
        .collect();
    assert_eq!(
        codes,
        [
            ("Z08_CLIENT_PUBLIC", "public"),
            ("Z08_CLIENT_UNREADABLE", "client/Feed.tsx")
        ],
        "{report:#}"
    );
    // A stylesheet's relative url(...) names a file the text-only candidate can't carry: refused at
    // the reference. Data URIs, absolute URLs and commented-out references need no file.
    std::fs::remove_dir_all(root.join("public")).unwrap();
    std::fs::copy(fixture("client-app/client/Feed.tsx"), root.join("client/Feed.tsx")).unwrap();
    let css = "/* url(./old.png) */\nmain { background: url(data:image/png;base64,AAAA); }\nh1 { background: url( 'https://cdn.test/a.png' ); }\nheader { background: url(\"./logo.png\"); }\n";
    std::fs::write(root.join("client/styles.css"), css).unwrap();
    let (ok, report) = migrate(
        &root,
        &temp.path().join("out3"),
        &["--space", "s", "--users", "--dry-run", "--zero-css", styles()],
    );
    assert!(!ok);
    let errors = report["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 1, "{report:#}");
    let e = &errors[0];
    assert_eq!(
        (
            e["code"].as_str(),
            e["file"].as_str(),
            e["line"].as_u64(),
            e["column"].as_u64()
        ),
        (
            Some("Z08_CLIENT_ASSET"),
            Some("client/styles.css"),
            Some(4),
            Some(css.lines().nth(3).unwrap().find("url(").unwrap() as u64 + 1)
        ),
        "{e}"
    );
    assert!(e["reason"].as_str().unwrap().contains("url(./logo.png)"), "{e}");
}

fn copy_dir(from: &Path, to: &Path) {
    for path in walk(from) {
        let target = to.join(path.strip_prefix(from).unwrap());
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::copy(&path, target).unwrap();
    }
}

/// Runs `script` as an ES module in Node with the converted bridge's path as `process.argv[1]`.
fn bridge(out: &Path, script: &str) -> Value {
    let node = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .arg(out.join("public/first/client.js"))
        .output()
        .expect("node is required");
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    serde_json::from_slice(&node.stdout).unwrap()
}

/// `usePaginatedQuery("page", { shelf })` reaches `page(ctx, shelf, options: PaginationOptions)` with
/// the shelf as the first input and `{ numItems, cursor }` as the second, as the action declares.
#[test]
fn the_client_bridge_maps_paginated_queries_onto_the_handler_inputs() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("client-app");
    let (ok, report) = migrate(
        &fixture("client-app"),
        &out,
        &["--space", "spc_migrate_test", "--users", "--zero-css", styles()],
    );
    assert!(ok, "{report:#}");
    let ran = bridge(
        &out,
        r#"
const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ data: { page: [], isDone: true, continueCursor: null } }), { status: 200 });
};
const bridge = await import(process.argv[1]);
await bridge.run("page", bridge.paginatedArgs("page", { shelf: "inbox" }, { numItems: 2, cursor: null }));
console.log(JSON.stringify(sent[0]));
"#,
    );
    assert_eq!(
        ran,
        serde_json::json!({ "shelf": "inbox", "options": { "numItems": 2, "cursor": null } })
    );
    // Those are exactly the inputs the generated action takes.
    build(&out);
    let plugin = out.join("first/dist/wp-content/plugins/first-app-shelf-notes/first/app/schema.php");
    let script = "echo json_encode(array_keys((require $argv[1])['actions']['page']['input']));";
    let php = Command::new("php").args(["-r", script]).arg(plugin).output().unwrap();
    assert!(php.status.success(), "{}", String::from_utf8_lossy(&php.stderr));
    let inputs: Value = serde_json::from_slice(&php.stdout).unwrap();
    assert_eq!(inputs, serde_json::json!(["shelf", "options"]));
}

/// A guest whose access token expired is refreshed and stays the same guest; a handler that refuses
/// guests leaves the session alone; a new guest is minted only without a session, or when the
/// session can't be renewed.
#[test]
fn the_client_bridge_keeps_a_guest_identity_across_token_expiry() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("client-app");
    let (ok, report) = migrate(
        &fixture("client-app"),
        &out,
        &["--space", "spc_migrate_test", "--users", "--zero-css", styles()],
    );
    assert!(ok, "{report:#}");
    // A server that issues guest-1 once, expires its first access token, and refreshes it.
    let ran = bridge(
        &out,
        r#"
const store = new Map();
globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
const calls = [];
let guests = 0;
const json = (status, body) => new Response(JSON.stringify(body), { status });
globalThis.fetch = async (url, init) => {
  const auth = init.headers?.authorization ?? null;
  calls.push(`${init.method} ${url} ${auth ?? "-"}`);
  if (url.endsWith("/auth/guest")) {
    const n = ++guests;
    return json(201, { data: { accessToken: n === 1 ? "a1" : `g${n}`, refreshToken: n === 1 ? "r1" : `rg${n}`, clientId: "guests", user: { id: n } } });
  }
  if (url.endsWith("/auth/config")) return json(200, { data: { issuer: "https://site.test/identity" } });
  if (url === "https://site.test/identity/token") {
    const form = new URLSearchParams(init.body);
    if (form.get("refresh_token") !== "r1" || form.get("client_id") !== "guests") return json(400, { error: "invalid_grant" });
    return json(200, { access_token: "a2", refresh_token: "r2", expires_in: 3600 });
  }
  if (url.endsWith("/me")) return json(200, { data: null });
  if (url.endsWith("/actions/banner")) return json(401, { code: "unauthorized", detail: "Sign in to continue." });
  if (auth === null) return json(401, { code: "unauthorized", detail: "An identity is required." });
  if (auth === "Bearer a1" && store.has("expired")) return json(401, { code: "unauthenticated", detail: "expired" });
  return json(200, { data: auth });
};
const bridge = await import(process.argv[1]);
const first = await bridge.run("add", ["inbox", "x"]);
store.set("expired", "1");
const second = await bridge.run("add", ["inbox", "y"]);
const refused = await bridge.run("banner", ["ab", 1]).then(() => "ok", (e) => e.code);
const kept = JSON.parse(store.get("zero08.session"));
// A session the issuer won't renew (a refresh token it refused) falls back to a new guest, once.
store.set("zero08.session", JSON.stringify({ accessToken: "a1", refreshToken: "stale", clientId: "guests" }));
const fallback = await bridge.run("add", ["inbox", "z"]);
console.log(JSON.stringify({ first, second, refused, guests, session: kept, fallback, calls: calls.filter((c) => !c.includes("/me")) }));
"#,
    );
    assert_eq!(ran["first"], "Bearer a1", "{ran:#}");
    assert_eq!(
        ran["second"], "Bearer a2",
        "the refreshed token, not a new guest: {ran:#}"
    );
    assert_eq!(ran["refused"], "unauthorized", "{ran:#}");
    assert_eq!(
        ran["session"],
        serde_json::json!({ "accessToken": "a2", "refreshToken": "r2", "clientId": "guests" })
    );
    // Only the unrenewable session minted a second guest; refresh and refusal minted none.
    assert_eq!(ran["guests"], 2, "{ran:#}");
    assert_eq!(ran["fallback"], "Bearer g2", "the new guest's token: {ran:#}");
}

/// A refresh that can't reach the issuer keeps the session and fails the call, as runtime/client
/// does: no new guest. Once the issuer is back, the same session renews, and `/me` (useAuth) goes
/// through the same renewal instead of reporting a signed-out visitor.
#[test]
fn the_client_bridge_keeps_the_session_when_a_refresh_fails_on_the_network() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("client-app");
    let (ok, report) = migrate(
        &fixture("client-app"),
        &out,
        &["--space", "spc_migrate_test", "--users", "--zero-css", styles()],
    );
    assert!(ok, "{report:#}");
    let ran = bridge(
        &out,
        r#"
const store = new Map([["zero08.session", JSON.stringify({ accessToken: "a1", refreshToken: "r1", clientId: "guests" })]]);
globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
let offline = true;
let guests = 0;
const me = [];
const json = (status, body) => new Response(JSON.stringify(body), { status });
globalThis.fetch = async (url, init) => {
  const auth = init.headers?.authorization ?? null;
  if (url.endsWith("/me")) me.push(auth);
  if (url.endsWith("/auth/guest")) return json(201, { data: { accessToken: `g${++guests}`, refreshToken: "rg", clientId: "guests" } });
  if (url.endsWith("/auth/config")) return json(200, { data: { issuer: "https://site.test/identity" } });
  if (url === "https://site.test/identity/token") {
    if (offline) throw new TypeError("fetch failed");
    return json(200, { access_token: "a2", refresh_token: "r2", expires_in: 300 });
  }
  if (auth === "Bearer a1") return json(401, { code: "unauthenticated", detail: "expired" });
  if (url.endsWith("/me")) return json(200, { data: { id: 7, name: "Guest 7", role: "guest" } });
  return json(200, { data: auth });
};
const bridge = await import(process.argv[1]);
const failed = await bridge.run("add", ["inbox", "x"]).then(() => "ok", (e) => e.message);
const kept = JSON.parse(store.get("zero08.session"));
offline = false;
const retried = await bridge.run("add", ["inbox", "y"]);
// The renewal refreshes useAuth: /me goes out with the renewed token, not the expired one.
for (let i = 0; i < 20 && me.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
const renewedMe = me.slice(0, 1);
// /me itself renews: with an expired token held and the issuer up, auth still reports the user.
store.set("zero08.session", JSON.stringify({ accessToken: "a1", refreshToken: "r2", clientId: "guests" }));
const auth = await bridge.currentAuth();
console.log(JSON.stringify({ failed, kept, retried, guests, me: renewedMe, auth: auth.userId, session: JSON.parse(store.get("zero08.session")) }));
"#,
    );
    assert_eq!(
        ran["failed"], "fetch failed",
        "the network error reaches the caller: {ran:#}"
    );
    assert_eq!(
        ran["kept"],
        serde_json::json!({ "accessToken": "a1", "refreshToken": "r1", "clientId": "guests" }),
        "the session survives a failed refresh: {ran:#}"
    );
    assert_eq!(ran["retried"], "Bearer a2", "{ran:#}");
    assert_eq!(ran["guests"], 0, "no guest was minted: {ran:#}");
    assert_eq!(ran["me"], serde_json::json!(["Bearer a2"]), "{ran:#}");
    assert_eq!(ran["auth"], "7", "/me renewed instead of reporting a guest: {ran:#}");
    assert_eq!(ran["session"]["refreshToken"], "r2");
}

/// A writing GET endpoint that never reads the visitor converts to a GET route that writes, as 0.8
/// ran it: a cross-site request can do no more than an anonymous one. One that reads `ctx.auth`
/// stays refused (`endpoints_become_routes_and_unroutable_ones_refuse`).
#[test]
fn a_writing_get_that_never_reads_the_visitor_becomes_a_writing_get_route() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("hits");
    let (ok, report) = migrate(&fixture("hits"), &out, &[]);
    assert!(ok, "{report:#}");
    assert!(
        report["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["pointer"] == "/endpoints/seen" && e["outcome"] == "review"),
        "{report:#}"
    );
    build(&out);
    let run = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/wp.php"))
        .arg("eval")
        .arg(out.join("first/dist/wp-content"))
        .arg(
            r#"$get = fn ($tag) => $app->serveRoute($app->matchRoute("GET", "/api/seen/$tag"), "GET", "/api/seen/$tag", "", "", [], null, "https://hits.example/api/seen/$tag");
               $first = $get("a"); $get("a"); $get("b");
               global $wpdb;
               $table = $wpdb->get_var("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%hits%'");
               $rows = $wpdb->get_col("SELECT tag FROM `$table` ORDER BY id");
               echo json_encode(["status" => $first[0], "body" => $first[2], "rows" => $rows]), "\n";"#,
        )
        .arg("null")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&run.stdout);
    let got: Value = serde_json::from_str(stdout.lines().next_back().unwrap_or(""))
        .unwrap_or_else(|_| panic!("{stdout}{}", String::from_utf8_lossy(&run.stderr)));
    assert_eq!(
        (got["status"].as_i64(), got["body"].as_str()),
        (Some(200), Some("seen")),
        "{got}"
    );
    // Every GET wrote its row, as 0.8 did.
    assert_eq!(got["rows"], serde_json::json!(["a", "a", "b"]), "{got}");
}

/// An sf.jsonc cron that calls a converted GET endpoint travels unchanged in the candidate's
/// sf.jsonc: the Spacefast host keeps calling the same path with GET, now a v2 route. A cron
/// pointing at a POST endpoint is refused at that entry (the host only sends GET).
#[test]
fn crons_calling_converted_get_endpoints_are_carried() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("hits");
    copy_dir(&fixture("hits"), &root);
    let source = std::fs::read_to_string(root.join("server/index.ts")).unwrap().replace(
        "  endpoints: {\n",
        "  endpoints: {\n    sweep: endpoint({ method: \"GET\", path: \"/api/sweep\", readOnly: false }, async (ctx) => { await ctx.db.hits.insert({ tag: \"sweep\" }); return text(\"swept\"); }),\n    post: endpoint({ method: \"POST\", path: \"/api/post\" }, () => text(\"posted\")),\n",
    );
    std::fs::write(root.join("server/index.ts"), source).unwrap();
    let crons = serde_json::json!([{ "key": "sweep", "path": "/api/sweep", "schedule": "*/15 * * * *" }]);
    let config = |crons: &Value| serde_json::json!({ "name": "Hits", "runtime": { "kind": "zero", "server": "server/index.ts" }, "crons": crons });
    std::fs::write(root.join("sf.jsonc"), config(&crons).to_string()).unwrap();
    let out = temp.path().join("out");
    let (ok, report) = migrate(&root, &out, &[]);
    assert!(ok, "{report:#}");
    let carried: Value = serde_json::from_str(&std::fs::read_to_string(out.join("sf.jsonc")).unwrap()).unwrap();
    assert_eq!(carried["crons"], crons);
    build(&out);
    // The host calls the cron's path with GET; the converted route answers it and writes.
    let run = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/wp.php"))
        .arg("eval")
        .arg(out.join("first/dist/wp-content"))
        .arg(
            r#"$r = $app->serveRoute($app->matchRoute("GET", "/api/sweep"), "GET", "/api/sweep", "", "", ["x-spacefast-cron" => "sweep.1.x"], null, "https://hits.example/api/sweep");
               global $wpdb;
               $table = $wpdb->get_var("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%hits%'");
               echo json_encode(["status" => $r[0], "body" => $r[2], "rows" => $wpdb->get_col("SELECT tag FROM `$table`")]), "\n";"#,
        )
        .arg("null")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&run.stdout);
    let got: Value = serde_json::from_str(stdout.lines().next_back().unwrap_or(""))
        .unwrap_or_else(|_| panic!("{stdout}{}", String::from_utf8_lossy(&run.stderr)));
    assert_eq!(
        got,
        serde_json::json!({ "status": 200, "body": "swept", "rows": ["sweep"] })
    );

    // A cron at a POST endpoint: the host's GET never reached it, so it is refused at the entry.
    let posting =
        serde_json::json!([crons[0].clone(), { "key": "post", "path": "/api/post", "schedule": "0 * * * *" }]);
    std::fs::write(root.join("sf.jsonc"), config(&posting).to_string()).unwrap();
    let (ok, refused) = migrate(&root, &temp.path().join("refused"), &["--dry-run"]);
    assert!(!ok);
    let errors: Vec<(&str, &str, &str)> = refused["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["code"].as_str().unwrap(),
                e["pointer"].as_str().unwrap(),
                e["file"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        errors,
        [("Z08_OMITTED_CRON", "/sf.jsonc/crons/1", "sf.jsonc")],
        "{refused:#}"
    );
    assert!(refused["errors"][0]["reason"].as_str().unwrap().contains("`/api/post`"));
}

/// `ctx.gravatar.avatarUrl` gives 0.8's URL for every call in the fixture, refusals included (the
/// expected values are 0.8's own client run in Node; fixtures README). `profile` converts to a
/// fetch of Gravatar's public profile with 0.8's projection.
#[test]
fn ctx_gravatar_maps_to_the_same_avatar_urls() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("gravatar");
    let (ok, report) = migrate(&fixture("gravatar"), &out, &[]);
    assert!(ok, "{report:#}");
    build(&out);
    let expected: Value =
        serde_json::from_str(&std::fs::read_to_string(fixture("gravatar/expected.json")).unwrap()).unwrap();
    let mut calls: Vec<Value> = expected["calls"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| serde_json::json!(["avatar", { "email": c[0], "options": c[1] }]))
        .collect();
    calls.extend(
        expected["plain"]
            .as_array()
            .unwrap()
            .iter()
            .map(|email| serde_json::json!(["plain", { "email": email }])),
    );
    let results = run_actions(&out, &[], &Value::Array(calls));
    let want: Vec<Value> = expected["results"]
        .as_array()
        .unwrap()
        .iter()
        .chain(expected["plainResults"].as_array().unwrap())
        .map(|r| match r {
            Value::String(url) => serde_json::json!({ "data": url }),
            // 0.8 refused out-of-range options with a service_payload_invalid error.
            _ => serde_json::json!({ "error": "service_payload_invalid" }),
        })
        .collect();
    assert_eq!(results, Value::Array(want));
}

/// A finalize payload that kept its `zero.css` bytes (older 0.8 publishes did) supplies the
/// stylesheet itself: converting with `--manifest` needs no `--zero-css`.
#[test]
fn a_finalize_manifest_supplies_the_published_zero_css() {
    fn base64(bytes: &[u8]) -> String {
        const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let n = chunk
                .iter()
                .enumerate()
                .fold(0u32, |n, (i, b)| n | (*b as u32) << (16 - 8 * i));
            for i in 0..4 {
                out.push(if i <= chunk.len() {
                    A[(n >> (18 - 6 * i) & 63) as usize] as char
                } else {
                    '='
                });
            }
        }
        out
    }
    let temp = tempfile::tempdir().unwrap();
    let source = fixture("client-app");
    let files: Vec<Value> = walk(&source)
        .into_iter()
        .map(|path| {
            let bytes = std::fs::read(&path).unwrap();
            let relative = path.strip_prefix(&source).unwrap().to_string_lossy().replace('\\', "/");
            let sha = sha2::Sha256::digest(&bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            serde_json::json!({ "path": relative, "sha256": sha, "size": bytes.len() })
        })
        .filter(|f| f["path"] != "sf.jsonc")
        .collect();
    let css = std::fs::read(styles()).unwrap();
    let payload = serde_json::json!({
        "artifact": {
            "format": "stattic.zero.capsule.v1",
            "server": { "endpoints": [] },
            "pages": [],
            "sourceManifest": { "entries": { "client": "client/index.tsx", "server": "server/index.ts" }, "files": files },
        },
        "staticFiles": [{ "path": "zero.css", "size": css.len(), "contentBase64": base64(&css) }],
    });
    let manifest = temp.path().join("finalize.json");
    std::fs::write(&manifest, payload.to_string()).unwrap();
    // The fixture's sf.jsonc is not recorded, as a real manifest never records it.
    let published = temp.path().join("source");
    copy_dir(&source, &published);
    std::fs::remove_file(published.join("sf.jsonc")).unwrap();
    let out = temp.path().join("out");
    let output = Command::new(env!("CARGO_BIN_EXE_first"))
        .args(["migrate", "app", "--from", "zero-0.8", "--manifest"])
        .arg(&manifest)
        .arg(&published)
        .arg("--out")
        .arg(&out)
        .args(["--space", "spc_migrate_test", "--users"])
        .output()
        .unwrap();
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(output.status.success(), "{report:#}");
    assert_eq!(std::fs::read(out.join("public/zero.css")).unwrap(), css);
}
