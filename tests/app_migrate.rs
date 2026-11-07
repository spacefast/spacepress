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
    let types = Path::new(env!("CARGO_MANIFEST_DIR")).join("types/zero/index.d.ts");
    std::fs::write(project.join("tsconfig.json"), serde_json::json!({
        "compilerOptions": {"target":"ES2022", "lib":["ES2022"], "module":"ESNext", "moduleResolution":"bundler", "strict":true,"noEmit":true,"types":[],"paths":{"zero":[types]}},
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

#[test]
fn the_global_fetch_imports_from_zero_with_the_same_egress_policy() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("fetch");
    let (ok, report) = migrate(&fixture("fetch"), &out, &[]);
    assert!(ok, "{report:#}");
    let config = std::fs::read_to_string(out.join("server/index.ts")).unwrap();
    assert!(config.contains("import { fetch } from \"zero\";"), "{config}");
    assert!(config.contains("__z08EndpointValue(await response.json())"), "{config}");
    build(&out);
}

#[test]
fn ctx_crypto_maps_to_the_zero_crypto_namespace() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("crypto");
    let (ok, report) = migrate(&fixture("crypto"), &out, &[]);
    assert!(ok, "{report:#}");
    let config = std::fs::read_to_string(out.join("server/index.ts")).unwrap();
    assert!(
        !config.contains("ctx.crypto") && config.contains("__z08Crypto.hmacSha256("),
        "{config}"
    );
    build(&out);
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
        report["entries"].as_array().unwrap().iter().any(|e| e["outcome"] == "mapped"
            && e["reason"].as_str().unwrap().starts_with("ctx.crypto becomes crypto")),
        "{report:#}"
    );
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
