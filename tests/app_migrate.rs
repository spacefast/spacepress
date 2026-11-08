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
fn migrate(input: &Path, out: &Path, flags: &[&str]) -> (bool, Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_zero"))
        .args(["migrate", "app", "--from", "zero-0.8"])
        .arg(input)
        .arg("--out")
        .arg(out)
        .args(flags)
        .output()
        .unwrap();
    let report = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&output.stderr)));
    (output.status.success(), report)
}
fn build(project: &Path) {
    let output = Command::new(env!("CARGO_BIN_EXE_zero"))
        .arg("build")
        .arg(project)
        .arg("--quiet")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let types = root.join("types/zero/index.d.ts");
    // fetch, process and node:crypto come from the standard declarations (tests/host-types).
    let node = root.join("tests/host-types/node_modules/@types");
    assert!(node.join("node").is_dir(), "run: npm ci --prefix tests/host-types");
    std::fs::write(project.join("tsconfig.json"), serde_json::json!({
        "compilerOptions": {"target":"ES2022", "lib":["ES2022"], "module":"ESNext", "moduleResolution":"bundler", "strict":true,"noEmit":true,"types":["node"],"typeRoots":[node],"paths":{"zero":[types]}},
        "include":["zero.config.ts","zero.gen.ts","server/**/*.ts","shared/**/*.ts"]
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
    let config = std::fs::read_to_string(out.join("server/index.ts")).unwrap();
    assert!(!config.contains("invalidate"), "{config}");
    let snapshot: Value =
        serde_json::from_slice(&std::fs::read(out.join("zero/migrations/snapshot.json")).unwrap()).unwrap();
    assert_eq!(snapshot["tables"]["tasks"]["columns"]["id"]["autoIncrement"], true);
    assert_eq!(
        snapshot["tables"]["tasks"]["existingTable"],
        "sf_spc_migrate_test_tasks_3c47092ff0"
    );
    build(&out);
    // The committed adoption snapshot is exactly what build accepts, without a second migration.
    assert_eq!(std::fs::read_dir(out.join("zero/migrations")).unwrap().count(), 2);
    let (ok, collision) = migrate(&fixture("board"), &out, &["--space", "spc_migrate_test"]);
    assert!(!ok);
    assert_eq!(collision["status"], "refused");
    assert_eq!(collision["errors"][0]["pointer"], "");
    let mut changed = snapshot;
    changed["tables"]["tasks"]["existingTable"] = "some_other_table".into();
    std::fs::write(out.join("zero/migrations/snapshot.json"), changed.to_string()).unwrap();
    let check = Command::new(env!("CARGO_BIN_EXE_zero"))
        .arg("check")
        .arg(&out)
        .output()
        .unwrap();
    assert!(!check.status.success());
    assert!(String::from_utf8_lossy(&check.stderr).contains("cannot change after the first snapshot"));
}

#[test]
fn reuses_content_importer_and_normalizes_roles_without_claiming_grants() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("content");
    let (ok, report) = migrate(&fixture("content"), &out, &[]);
    assert!(ok, "{report:#}");
    assert_eq!(report["connector_roles"]["calendar"]["as"], "personal");
    assert_eq!(report["connector_roles"]["shared"]["as"], "team");
    assert_eq!(report["connector_roles"]["visitor"]["as"], "visitor");
    build(&out);
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
            "/helpers/listAll",
            "/helpers/owner",
            "/helpers/prefix",
            "/helpers/save",
            "/helpers/subject"
        ]
    );
    build(&out);
    // The candidate adopts existing 0.8 tables; run it on a fresh site with its own.
    let source = std::fs::read_to_string(out.join("server/index.ts")).unwrap();
    let fresh = regex::Regex::new(r#"existingTable: "[^"]*", "#)
        .unwrap()
        .replace_all(&source, "");
    std::fs::write(out.join("server/index.ts"), fresh.as_ref()).unwrap();
    std::fs::remove_dir_all(out.join("zero/migrations")).unwrap();
    let built = Command::new(env!("CARGO_BIN_EXE_zero"))
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
        .arg(out.join(".zero/wp-content"))
        .arg(
            r#"putenv("NOTE_PREFIX=hi ");
               $r = fn ($n, $in, $as) => $wp->call("POST", "/actions/$n", (object) $in, $as)[1];
               echo json_encode([
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
            "list": [["two", "anonymous"], ["one", "ada"]],
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
    let source = std::fs::read_to_string(shared.join("server/index.ts")).unwrap();
    std::fs::write(
        shared.join("server/index.ts"),
        regex::Regex::new(r#"existingTable: "[^"]*", "#)
            .unwrap()
            .replace_all(&source, "")
            .as_ref(),
    )
    .unwrap();
    std::fs::remove_dir_all(shared.join("zero/migrations")).unwrap();
    build(&shared);
    let run = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/wp.php"))
        .arg("eval")
        .arg(shared.join(".zero/wp-content"))
        .arg(
            r#"$r = fn ($n, $in, $as) => $wp->call("POST", "/actions/$n", (object) $in, $as);
               echo json_encode([
                 "guestAdd" => $r("add", ["body" => "x"], null)[0],
                 "guestWhoami" => $r("whoami", [], null)[1],
                 "memberAdd" => $r("add", ["body" => "y"], "ada")[1],
                 "rows" => $wp->scalar("SELECT COUNT(*) FROM {prefix}zero_notes"),
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
    ] {
        let root = temp.path().join(case);
        project(&root, "{}");
        std::fs::write(
            root.join("server/index.ts"),
            format!("import {{ capsule, query, string, table }} from \"@spacefast/zero/server\";\n{helper}\nexport default capsule({{ name: \"r\", schema: {{ notes: table({{ body: string() }}) }}, {handler} }});\n"),
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

#[test]
fn spacefast_content_only_root_adopts_native_posts_and_maps_realtime() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("source");
    project(&root, r#"{name:"spacefast-posts", realtime:{enabled:true}}"#);
    std::fs::create_dir_all(root.join("content/posts")).unwrap();
    std::fs::write(root.join("content/posts/hello.md"), "---\ntitle: Hello\n---\nBody").unwrap();
    let out = temp.path().join("candidate");
    let (ok, report) = migrate(&root, &out, &[]);
    assert!(ok, "{report:#}");
    let snapshot: Value =
        serde_json::from_slice(&std::fs::read(out.join("zero/migrations/snapshot.json")).unwrap()).unwrap();
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
    let out = temp.path().join("candidate");
    let (ok, report) = migrate(&root, &out, &["--users"]);
    assert!(ok, "{report:#}");
    let snapshot: Value =
        serde_json::from_slice(&std::fs::read(out.join("zero/migrations/snapshot.json")).unwrap()).unwrap();
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
    // Without Space Users there is no subject to carry, so userId stays refused.
    let (ok, refused) = migrate(&root, &out, &["--space", "spc_migrate_test", "--dry-run"]);
    assert!(!ok);
    assert_eq!(refused["errors"][0]["pointer"], "/queries/todos/ctx/auth/userId");
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
        serde_json::from_slice(&std::fs::read(out.join("zero/migrations/snapshot.json")).unwrap()).unwrap();
    assert_eq!(
        snapshot["tables"]["members"]["columns"]["spacefastSubject"]["type"], "text",
        "{:#}",
        snapshot["tables"]["members"]
    );
    build(&out);
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
          hit:endpoint({method:"GET",path:"/hit",readOnly:false},()=>text("")),
          url:endpoint({method:"GET",path:"/url"},(_ctx, req)=>text(req.url)),
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
            "/endpoints/hit",
            "/endpoints/url/request/url",
            "/endpoints/bytes/request/bytes",
            "/endpoints/two"
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
    let config = std::fs::read_to_string(out.join("server/index.ts")).unwrap();
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
        "shared/plans.ts",
    ] {
        assert!(out.join(file).is_file(), "{file}");
    }
    let pricing = std::fs::read_to_string(out.join("pages/pricing/page.tsx")).unwrap();
    assert!(
        pricing.contains("import { plans } from '../../shared/plans';"),
        "a single-quoted relative import moves with the page: {pricing}"
    );
    // Interactive starters keep a pointer per page saying what to port.
    let (ok, refused) = migrate(
        &corpus("starter-todo"),
        &temp.path().join("todo"),
        &["--users", "--space", "s", "--dry-run"],
    );
    assert!(!ok);
    let errors = refused["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 2);
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
        "{\n  // the 0.8 runtime block\n  \"runtime\": { \"kind\": \"zero\", \"server\": \"server/app.ts\", },\n}\n",
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
    assert!(out.join("server/index.ts").is_file());
    assert!(!out.join("server/app.ts").exists());
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
    let config = std::fs::read_to_string(out.join("server/index.ts")).unwrap();
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
    let content = project.join(".zero/wp-content/plugins");
    let app = std::fs::read_dir(&content)
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.is_dir() && p.file_name().unwrap().to_string_lossy().starts_with("zero-app-"))
        .unwrap()
        .join("zero/app");
    let script = r#"
require $argv[1];
$schema = require $argv[2] . '/schema.php';
require $argv[2] . '/functions.php';
$out = [];
foreach (json_decode(file_get_contents('php://stdin'), true) as [$name, $input, $env]) {
  \Zero\Env::isolate($env);
  $fn = '\\ZeroApp\\' . $schema['actions'][$name]['handler'];
  try { $out[] = ['data' => $fn(\Zero\Seam::toJs($input, ['type' => 'json']), \Zero\Seam::ctx(['user' => null]))]; }
  catch (\Zero\HttpError $e) { $out[] = ['error' => $e->errorCode]; }
}
echo \Zero\Js::jsonStringify($out);
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
        .arg(content.join("zero-runtime/zero/bootstrap.php"))
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
        r#"{actions:{token:action(async (ctx) => ctx.jwt.sign({ key: "K", kid: "k1", claims: {} }))}}"#,
    );
    let source = std::fs::read_to_string(root.join("server/index.ts"))
        .unwrap()
        .replace("import { capsule }", "import { action, capsule }");
    std::fs::write(root.join("server/index.ts"), source).unwrap();
    let (ok, refused) = migrate(&root, &temp.path().join("no"), &["--dry-run"]);
    assert!(!ok);
    assert_eq!(refused["errors"][0]["pointer"], "/actions/token/ctx/jwt");
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
    let mut command = Command::new(env!("CARGO_BIN_EXE_zero"));
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
    let (ok, report) = migrate_manifest(&manifest, Some(&source), &temp.path().join("b"));
    assert!(ok, "{report:#}");
    assert_eq!(report["status"], "dry-run");

    // Files the publish did not record are not part of the published version: a page added later
    // and an sf.jsonc naming another entry are both ignored, so the candidate is the publish's.
    std::fs::create_dir_all(source.join("pages")).unwrap();
    std::fs::write(
        source.join("pages/added.tsx"),
        "export default function Added() { return <p>later</p>; }\n",
    )
    .unwrap();
    std::fs::write(source.join("sf.jsonc"), r#"{"runtime":{"server":"server/other.ts"}}"#).unwrap();
    let out = temp.path().join("b2");
    let output = Command::new(env!("CARGO_BIN_EXE_zero"))
        .args(["migrate", "app", "--from", "zero-0.8", "--manifest"])
        .arg(&manifest)
        .arg(&source)
        .arg("--out")
        .arg(&out)
        .args(["--space", "spc_migrate_test", "--users"])
        .output()
        .unwrap();
    let written: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(output.status.success(), "{written:#}");
    assert!(
        !out.join("pages/added/page.tsx").exists(),
        "an unrecorded page reached the candidate"
    );
    assert!(!out.join("pages").exists());
    std::fs::remove_dir_all(source.join("pages")).unwrap();
    std::fs::remove_file(source.join("sf.jsonc")).unwrap();

    // A recorded binary asset is compared by its bytes, not refused as unreadable text.
    let mut with_image: Value = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
    let png: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe];
    std::fs::create_dir_all(source.join("public")).unwrap();
    std::fs::write(source.join("public/logo.png"), png).unwrap();
    with_image["artifact"]["sourceManifest"]["files"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "path": "public/logo.png", "size": png.len(),
            "sha256": sha2::Sha256::digest(png).iter().map(|b| format!("{b:02x}")).collect::<String>(),
        }));
    let image_path = temp.path().join("with-image.json");
    std::fs::write(&image_path, with_image.to_string()).unwrap();
    let (ok, report) = migrate_manifest(&image_path, Some(&source), &temp.path().join("b4"));
    assert!(ok, "{report:#}");
    std::fs::write(source.join("public/logo.png"), b"\xff\xfe changed").unwrap();
    let (ok, report) = migrate_manifest(&image_path, Some(&source), &temp.path().join("b5"));
    assert!(!ok);
    assert!(
        report["errors"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("public/logo.png (changed)"),
        "{report:#}"
    );
    std::fs::remove_dir_all(source.join("public")).unwrap();

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
            "/endpoints/GET ~1hit",
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

/// Language constructs live 0.8 apps use (zero#138) convert and build. Each construct also has a
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
        .arg(out.join(".zero/wp-content"))
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

/// A 0.8 client app without pages converts: actions and tables into zero.config.ts, the client
/// into public/, and the candidate checks with no diagnostics.
#[test]
fn a_client_app_without_pages_becomes_public_files_and_checks_clean() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("client-app");
    let (ok, report) = migrate(
        &fixture("client-app"),
        &out,
        &["--space", "spc_migrate_test", "--users"],
    );
    assert!(ok, "{report:#}");
    for file in [
        "zero.config.ts",
        "public/index.html",
        "public/zero/main.js",
        "public/zero/client.js",
        "public/zero/handlers.js",
        "public/app/client/index.js",
        "public/app/client/Shelf.js",
        "public/app/shared/format.js",
        "public/client/styles.css",
    ] {
        assert!(out.join(file).is_file(), "{file}");
    }
    let review = report["entries"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["pointer"] == "/client/index.tsx" && e["outcome"] == "review");
    assert!(review, "{report:#}");
    let checked = Command::new(env!("CARGO_BIN_EXE_zero"))
        .args(["check", "--json"])
        .arg(&out)
        .output()
        .unwrap();
    let checked: Value = serde_json::from_slice(&checked.stdout).unwrap();
    assert_eq!(checked["ok"], true, "{checked}");
    assert_eq!(checked["diagnostics"].as_array().unwrap().len(), 0, "{checked}");
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
        &["--space", "spc_migrate_test", "--users"],
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
        .arg(out.join("public/zero/client.js"))
        .output()
        .expect("node is required");
    assert!(node.status.success(), "{}", String::from_utf8_lossy(&node.stderr));
    let ran: Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(ran["sent"][0]["url"], "/wp-json/zero/v1/actions/banner", "{ran}");
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
        &["--space", "s", "--users", "--dry-run"],
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
        .arg(out.join("public/zero/client.js"))
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
        &["--space", "spc_migrate_test", "--users"],
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
    let plugin = out.join(".zero/wp-content/plugins/zero-app-shelf-notes/zero/app/schema.php");
    let script = "echo json_encode(array_keys((require $argv[1])['actions']['page']['input']));";
    let php = Command::new("php").args(["-r", script]).arg(plugin).output().unwrap();
    assert!(php.status.success(), "{}", String::from_utf8_lossy(&php.stderr));
    let inputs: Value = serde_json::from_slice(&php.stdout).unwrap();
    assert_eq!(inputs, serde_json::json!(["shelf", "options"]));
}

/// A guest whose access token expired is refreshed and stays the same guest; a handler that refuses
/// guests leaves the session alone; only a visitor with no session gets a new guest.
#[test]
fn the_client_bridge_keeps_a_guest_identity_across_token_expiry() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("client-app");
    let (ok, report) = migrate(
        &fixture("client-app"),
        &out,
        &["--space", "spc_migrate_test", "--users"],
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
  if (url.endsWith("/auth/guest")) return json(201, { data: { accessToken: "a1", refreshToken: "r1", clientId: "guests", user: { id: ++guests } } });
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
console.log(JSON.stringify({ first, second, refused, guests, session: JSON.parse(store.get("zero08.session")), calls: calls.filter((c) => !c.includes("/me")) }));
"#,
    );
    assert_eq!(ran["first"], "Bearer a1", "{ran:#}");
    assert_eq!(
        ran["second"], "Bearer a2",
        "the refreshed token, not a new guest: {ran:#}"
    );
    assert_eq!(ran["refused"], "unauthorized", "{ran:#}");
    assert_eq!(ran["guests"], 1, "one guest for the whole visit: {ran:#}");
    assert_eq!(
        ran["session"],
        serde_json::json!({ "accessToken": "a2", "refreshToken": "r2", "clientId": "guests" })
    );
}
