#![cfg(feature = "cli")]
//! A `zero.source-bundle.v1` upload (what the 0.3.0 compiler captured, before the rename to First)
//! compiles to the same tree as the same app captured by this compiler. The 0.3.0 files are frozen
//! fixtures (tests/fixtures/zero-0.3/README.md says how they were made).

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/zero-0.3");

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// Every file of a tree, relative path → bytes.
fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else {
                let rel = path.strip_prefix(root).unwrap().display().to_string();
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    out
}

/// The fixture app ported to First by hand, as its owner would: First names, `first/`, and the
/// current field forms (tests/fixtures/zero-0.3/ported/), with the 0.3.0 ledger.
fn ported(work: &Path) -> PathBuf {
    let app = work.join("ported");
    copy_dir(&Path::new(FIXTURE).join("ported"), &app);
    fs::create_dir_all(app.join("first/_generated/migrations")).unwrap();
    for name in ["0001_init.sql", "snapshot.json"] {
        fs::copy(
            Path::new(FIXTURE).join("app/zero/migrations").join(name),
            app.join("first/_generated/migrations").join(name),
        )
        .unwrap();
    }
    app
}

fn manifest(dir: &Path) -> serde_json::Value {
    serde_json::from_slice(&fs::read(dir.join("manifest.json")).unwrap()).unwrap()
}

#[test]
fn a_zero_source_bundle_compiles_like_the_same_app_captured_as_first() {
    let work = tempfile::tempdir().unwrap();
    let legacy = Path::new(FIXTURE).join("sources");
    let compiled_legacy = work.path().join("compiled-legacy");
    first::bundle::compile(&legacy, &compiled_legacy, &legacy, None).unwrap();

    let captured = work.path().join("captured");
    first::bundle::sources(&ported(work.path()), &captured).unwrap();
    let compiled_first = work.path().join("compiled-first");
    first::bundle::compile(&captured, &compiled_first, &captured, None).unwrap();

    let (a, b) = (manifest(&compiled_legacy), manifest(&compiled_first));
    assert_eq!(a["format"], "first.hosted.v1");
    assert_eq!(a["app"], "notes");
    for key in ["format", "compiler", "app", "requires", "pages", "routes", "pagePaths"] {
        assert_eq!(a[key], b[key], "manifest {key}");
    }
    let (mut a, mut b) = (tree(&compiled_legacy), tree(&compiled_first));
    // The manifests name their own source hashes; the archive keeps each capture's ledger as sent.
    for t in [&mut a, &mut b] {
        t.remove("manifest.json");
    }
    let differing: Vec<_> = a
        .keys()
        .chain(b.keys())
        .filter(|k| a.get(*k) != b.get(*k))
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    assert!(differing.is_empty(), "compiled trees differ in {differing:?}");
    let migrations = tree(&compiled_legacy.join("migrations"));
    assert_eq!(migrations.keys().collect::<Vec<_>>(), ["0001_init.sql"]);
    let sql = String::from_utf8(migrations["0001_init.sql"].clone()).unwrap();
    assert!(sql.contains("CREATE TABLE `{prefix}first_notes`"), "{sql}");
}

#[test]
fn recompiling_a_zero_bundle_on_its_0_3_output_adds_no_migration() {
    let work = tempfile::tempdir().unwrap();
    let legacy = Path::new(FIXTURE).join("sources");
    let previous = Path::new(FIXTURE).join("compiled");
    let output = work.path().join("compiled");
    first::bundle::compile(&legacy, &output, &legacy, Some(&previous)).unwrap();
    let migrations = tree(&output.join("migrations"));
    // The previous tree's ledger is carried as it is, and nothing new is planned against its snapshot.
    assert_eq!(migrations.keys().collect::<Vec<_>>(), ["0001_init.sql"]);
    assert_eq!(
        migrations["0001_init.sql"],
        fs::read(previous.join("migrations/0001_init.sql")).unwrap()
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&fs::read(output.join("snapshot.json")).unwrap()).unwrap(),
        serde_json::from_slice::<serde_json::Value>(&fs::read(previous.join("snapshot.json")).unwrap()).unwrap()
    );
}

/// The 0.3.0 field reading belongs to the 0.3.0 capture format: the same source in a live First
/// project is refused at the first old form, naming its replacement.
#[test]
fn the_0_3_field_forms_are_read_only_from_a_zero_bundle() {
    let work = tempfile::tempdir().unwrap();
    let app = work.path().join("live");
    copy_dir(&Path::new(FIXTURE).join("app"), &app);
    let config = fs::read_to_string(app.join("zero.config.ts")).unwrap();
    fs::write(
        app.join("first.config.ts"),
        config
            .replace("from \"zero\"", "from \"first\"")
            .replace("\"./lib/fields\"", "\"./first/lib/fields\""),
    )
    .unwrap();
    fs::remove_file(app.join("zero.config.ts")).unwrap();
    fs::create_dir_all(app.join("first/lib")).unwrap();
    fs::rename(app.join("lib/fields.ts"), app.join("first/lib/fields.ts")).unwrap();
    let Err(error) = first::bundle::sources(&app, &work.path().join("captured")) else {
        panic!("0.3.0 field forms in a First project compiled")
    };
    assert!(
        error
            .message
            .contains("`.notNull()` is gone: fields are required by default"),
        "{}",
        error.message
    );
}

#[test]
fn a_zero_source_bundle_is_refused_when_tampered_or_mixed() {
    let work = tempfile::tempdir().unwrap();
    let output = work.path().join("out");

    let tampered = work.path().join("tampered");
    copy_dir(&Path::new(FIXTURE).join("sources"), &tampered);
    let mut app = fs::read(tampered.join("app.zero.json")).unwrap();
    app.push(b' ');
    fs::write(tampered.join("app.zero.json"), app).unwrap();
    let error = first::bundle::compile(&tampered, &output, &tampered, None).unwrap_err();
    assert_eq!(error.message, "source bundle hash mismatch: app.zero.json");
    assert!(!output.exists());

    let mixed = work.path().join("mixed");
    copy_dir(&Path::new(FIXTURE).join("sources"), &mixed);
    fs::copy(mixed.join("app.zero.json"), mixed.join("app.first.json")).unwrap();
    let error = first::bundle::compile(&mixed, &output, &mixed, None).unwrap_err();
    assert!(error.message.contains("also has app.first.json"), "{}", error.message);
    assert!(!output.exists());
}

/// A 0.3.0 app with TSX pages (`pages/` and its rendered `zero/pages.json`: 0.3.0's full-site
/// example as its compiler captured it) is refused, and the message says what the owner does.
#[test]
fn a_zero_source_bundle_with_rendered_pages_is_refused_with_how_to_publish_again() {
    let work = tempfile::tempdir().unwrap();
    let bundle = Path::new(FIXTURE).join("pages/sources");
    let output = work.path().join("out");
    let error = first::bundle::compile(&bundle, &output, &bundle, None).unwrap_err();
    assert_eq!(
        error.message,
        "this bundle has TSX pages (pages/) rendered by the 0.3.0 compiler, which First can't serve"
    );
    let help = error.help.unwrap_or_default();
    assert!(
        help.contains("first/app/<path>/page.tsx") && help.contains("`first sources`"),
        "{help}"
    );
    assert!(!output.exists());
    // `pages/` sources alone, without their artifact, are refused the same way.
    let sources_only = edited_capture(work.path(), "pages/page.tsx", |_| "export default () => null;".into());
    let error = first::bundle::compile(&sources_only, &output, &sources_only, None).unwrap_err();
    assert!(error.message.contains("TSX pages (pages/)"), "{}", error.message);
    assert!(!output.exists());
}

/// Rewrites (or adds) one file of a copy of the 0.3.0 capture and re-hashes the app bundle, as a client that
/// predates the rename would have captured that source.
fn edited_capture(work: &Path, path: &str, edit: impl FnOnce(&str) -> String) -> PathBuf {
    let bundle = work.join("edited");
    copy_dir(&Path::new(FIXTURE).join("sources"), &bundle);
    let mut app: serde_json::Value = serde_json::from_slice(&fs::read(bundle.join("app.zero.json")).unwrap()).unwrap();
    let source = app["files"][path].as_str().unwrap_or_default().to_string();
    app["files"][path] = edit(&source).into();
    let bytes = serde_json::to_vec(&app).unwrap();
    fs::write(bundle.join("app.zero.json"), &bytes).unwrap();
    let mut manifest = manifest(&bundle);
    manifest["app_sha256"] = {
        use sha2::Digest;
        sha2::Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
            .into()
    };
    fs::write(bundle.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    bundle
}

/// The 0.3.0 reading keeps `.references()`, to `id` or to another unique key, and `defineRelations`
/// (docs/decisions/2026-11-11-authoring-surface.md, rulings 21 and 22): the schema they compile to is
/// the shape the runtime's non-id reference checks (tests/php) are written against.
#[test]
fn a_zero_capture_keeps_its_references_and_relations() {
    let work = tempfile::tempdir().unwrap();
    let bundle = edited_capture(work.path(), "zero.config.ts", |source| {
        source
            .replace(
                "import { collection, table,",
                "import { collection, table, defineRelations,",
            )
            .replace(
                "export const pages = collection({",
                "export const links = table({\n  noteId: integer().notNull().references(() => notes.id, { onDelete: \"cascade\" }),\n  noteSlug: text().max(191).references(() => notes.slug),\n});\nexport const relations = defineRelations({ notes, links }, (r) => ({\n  links: { note: r.one.notes({ from: r.links.noteId, to: r.notes.id, optional: false }) },\n  notes: { links: r.many.links() },\n}));\n\nexport const pages = collection({",
            )
            .replace("  tables: { notes },", "  tables: { notes, links },\n  relations,")
    });
    let out = work.path().join("out");
    first::bundle::compile(&bundle, &out, &bundle, None).unwrap();
    let schema = std::process::Command::new("php")
        .args(["-r", "echo json_encode(require $argv[1]);"])
        .arg(out.join("plugins/first-app-notes/first/app/schema.php"))
        .output()
        .unwrap();
    assert!(schema.status.success(), "{}", String::from_utf8_lossy(&schema.stderr));
    let schema: serde_json::Value = serde_json::from_slice(&schema.stdout).unwrap();
    let links = &schema["collections"]["links"];
    assert_eq!(links["columns"]["noteId"]["references"]["column"], "id");
    assert_eq!(links["columns"]["noteId"]["references"]["onDelete"], "cascade");
    assert_eq!(links["columns"]["noteId"]["notNull"], true);
    assert_eq!(links["columns"]["noteSlug"]["references"]["collection"], "notes");
    assert_eq!(links["columns"]["noteSlug"]["references"]["column"], "slug");
    assert_eq!(
        links["columns"]["noteSlug"].get("notNull"),
        None,
        "a plain 0.3.0 field is nullable"
    );
    assert_eq!(links["relations"]["note"]["from"], "noteId");
    assert_eq!(schema["collections"]["notes"]["relations"]["links"]["to"], "noteId");
}

/// What a deployed 0.3.0 Space's next version serves its pages: recompiled from its stored
/// `zero.source-bundle.v1`, its generated client, run under Node, calls First's API at
/// `/__first/api/v1` (tests/wp/zero-upgrade proves what the site answers there and on the old paths).
#[test]
fn a_recompiled_zero_bundle_client_calls_the_first_api() {
    let work = tempfile::tempdir().unwrap();
    let legacy = Path::new(FIXTURE).join("sources");
    let output = work.path().join("compiled");
    first::bundle::compile(&legacy, &output, &legacy, Some(&Path::new(FIXTURE).join("compiled"))).unwrap();
    let client = tree(&output)
        .into_keys()
        .find(|k| k.ends_with("client/client.js"))
        .expect("a generated client");
    let probe = work.path().join("probe.mjs");
    fs::write(
        &probe,
        format!(
            "const calls = [];\nglobalThis.fetch = async (url, init) => {{ calls.push([init?.method ?? 'GET', String(url)]); return new Response(JSON.stringify({{ data: [], cursor: null }}), {{ status: 200, headers: {{ 'content-type': 'application/json' }} }}); }};\nconst {{ createClient }} = await import({:?});\nconst c = createClient({{ fetch: globalThis.fetch }});\nawait c.notes.list();\nawait c.actions.count({{}});\nconsole.log(JSON.stringify(calls));\n",
            format!("file://{}", output.join(&client).display())
        ),
    )
    .unwrap();
    let out = std::process::Command::new("node").arg(&probe).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let calls: Vec<(String, String)> = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(calls.len(), 2, "{calls:?}");
    for (_, url) in &calls {
        assert!(url.starts_with("/__first/api/v1/"), "{calls:?}");
    }
    assert_eq!(calls[0], ("GET".into(), "/__first/api/v1/notes".into()));
    assert_eq!(calls[1].1, "/__first/api/v1/actions/count");
}

/// The 0.3.0 fixtures beside the first one: `forms` (every form 0.3.0 accepted) and `routes`.
fn app(name: &str) -> PathBuf {
    Path::new(FIXTURE).join(name)
}

/// The schema a compiled tree's app plugin serves, as JSON (`php` reads `schema.php`).
fn schema_php(path: &Path) -> serde_json::Value {
    let out = std::process::Command::new("php")
        .arg("-r")
        .arg("echo json_encode(require $argv[1], JSON_THROW_ON_ERROR);")
        .arg(path)
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
}

/// The 0.3.0 schema with its names as First stores them (`zero_` → `first_`, the stored-name
/// upgrade; docs/spacefast-host-checklist.md item 9).
fn renamed(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => s.replace("zero_", "first_").replace("zero-", "first-").into(),
        serde_json::Value::Array(a) => a.iter().map(renamed).collect(),
        serde_json::Value::Object(o) => o.iter().map(|(k, v)| (k.clone(), renamed(v))).collect(),
        other => other.clone(),
    }
}

/// Every place `old` differs from `new`, except keys `new` adds: what 0.3.0 said and First says otherwise.
fn changed(old: &serde_json::Value, new: &serde_json::Value, at: &str, out: &mut Vec<String>) {
    match (old, new) {
        (serde_json::Value::Object(a), serde_json::Value::Object(b)) => {
            for (k, v) in a {
                match b.get(k) {
                    Some(w) => changed(v, w, &format!("{at}/{k}"), out),
                    None => out.push(format!("{at}/{k} is gone")),
                }
            }
        }
        _ if old != new => out.push(format!("{at}: {old} became {new}")),
        _ => {}
    }
}

/// Every authoring form the 0.3.0 compiler accepted, in one stored bundle, recompiled on the tree its
/// 0.3.0 build left: no new migration, the same snapshot, and the same served schema apart from what
/// First reads differently on purpose (each listed below, with why it serves the same).
#[test]
fn every_0_3_authoring_form_recompiles_to_the_schema_0_3_served() {
    let work = tempfile::tempdir().unwrap();
    let sources = app("forms").join("sources");
    let previous = app("forms").join("compiled");
    let output = work.path().join("compiled");
    first::bundle::compile(&sources, &output, &sources, Some(&previous)).unwrap();
    let migrations = tree(&output.join("migrations"));
    assert_eq!(migrations.keys().collect::<Vec<_>>(), ["0001_init.sql"]);
    assert_eq!(
        migrations["0001_init.sql"],
        fs::read(previous.join("migrations/0001_init.sql")).unwrap()
    );
    let snapshot = |p: &Path| -> serde_json::Value {
        serde_json::from_slice(&fs::read(p.join("snapshot.json")).unwrap()).unwrap()
    };
    assert_eq!(snapshot(&output), snapshot(&previous));
    // Planned from nothing (the first version a host compiles), the same first migration.
    let fresh = work.path().join("fresh");
    first::bundle::compile(&sources, &fresh, &sources, None).unwrap();
    assert_eq!(snapshot(&fresh), snapshot(&previous));

    let old = renamed(&schema_php(&previous.join("schema.php")));
    let new = schema_php(&output.join("plugins/first-app-forms/first/app/schema.php"));
    let mut differences = Vec::new();
    changed(&old, &new, "", &mut differences);
    assert_eq!(
        differences,
        [
            // `routes` moved onto the first/app/ route table (`app`, asserted below and served in
            // a_recompiled_zero_bundle_serves_its_routes_as_0_3_did).
            "/routes is gone",
            // The timestamped scheme was renamed with the product; it verifies the same header.
            "/actions/hook/signature/scheme: \"zero\" became \"first\"",
        ],
        "{new:#}"
    );
    let app = &new["app"];
    assert_eq!(app["legacyRoutes"], true);
    let mut routes: Vec<(String, String, serde_json::Value, serde_json::Value)> = app["routes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            let file = &app["files"][r["handler"].as_str().unwrap()];
            let (method, handler) = file["methods"].as_object().unwrap().iter().next().unwrap();
            assert_eq!(handler, &old["routes"][r["id"].as_str().unwrap()]["handler"]);
            (
                method.clone(),
                r["pattern"].as_str().unwrap().to_owned(),
                file["access"].clone(),
                file["signature"].clone(),
            )
        })
        .collect();
    routes.sort_by(|a, b| a.1.cmp(&b.1));
    let mut expected: Vec<_> = old["routes"]
        .as_object()
        .unwrap()
        .values()
        .map(|r| {
            let access = if r["signature"].is_null() {
                r["access"].clone()
            } else {
                serde_json::Value::Null
            };
            (
                r["method"].as_str().unwrap().to_owned(),
                r["path"].as_str().unwrap().to_owned(),
                access,
                r["signature"].clone(),
            )
        })
        .collect();
    expected.sort_by(|a, b| a.1.cmp(&b.1));
    assert_eq!(routes, expected);
    let manifest = manifest(&output);
    assert_eq!(manifest["pagePaths"], serde_json::json!([]));
    assert_eq!(
        manifest["routes"].as_array().unwrap().len(),
        old["routes"].as_object().unwrap().len()
    );
}

/// What a recompiled 0.3.0 `routes` app answers on WordPress, request by request, is what the 0.3.0
/// runtime answered (tests/fixtures/zero-0.3/routes/served.json): each route among those of its
/// method, the literal before the `:param`, 405 for a known path's other method, access rules and
/// signatures as declared, trusted reads, and the theme still serving the home page.
#[test]
fn a_recompiled_zero_bundle_serves_its_routes_as_0_3_did() {
    let work = tempfile::tempdir().unwrap();
    let sources = app("routes").join("sources");
    let output = work.path().join("compiled");
    first::bundle::compile(&sources, &output, &sources, None).unwrap();
    let out = std::process::Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/zero_routes.php"))
        .arg(&output)
        .env("FIRST_WP_THEMES", "1")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let mut served: serde_json::Value = serde_json::from_slice(out.stdout.trim_ascii())
        .unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)));
    assert_eq!(
        served["home"],
        serde_json::json!([200, true]),
        "the theme renders the home page"
    );
    served.as_object_mut().unwrap().remove("home");
    let recorded: serde_json::Value =
        serde_json::from_slice(&fs::read(app("routes").join("served.json")).unwrap()).unwrap();
    assert_eq!(served, recorded);
}

/// A First project that writes one of the 0.3.0 forms an old bundle still reads: refused at the
/// form, with its replacement. (`.notNull()` in a whole 0.3.0 app:
/// the_0_3_field_forms_are_read_only_from_a_zero_bundle.)
#[test]
fn the_0_3_forms_other_lanes_removed_are_refused_in_a_first_project() {
    let cases: &[(&str, &str, &str)] = &[
        (
            r#"import { defineConfig, route } from "first";
export default defineConfig({});"#,
            "\"first\" has no export named `route`",
            "first/app/<path>/route.ts",
        ),
        (
            r#"import { defineConfig } from "first";
export default defineConfig({ routes: {} });"#,
            "defineConfig() has no option `routes`",
            "first/app/<path>/route.ts",
        ),
        (
            r#"import { defineConfig, action, env } from "first";
export default defineConfig({ actions: { hook: action({ input: {}, signature: { secret: env("S"), header: "x-sig", scheme: "zero" }, handler() { return 1; } }) } });"#,
            "signature.scheme must be first or hmac-sha256",
            "",
        ),
        (
            r#"import { defineConfig, table, text } from "first";
const codes = table({ code: text().primaryKey().max(40) });
export default defineConfig({ tables: { codes } });"#,
            "`.primaryKey()` is gone",
            "`get({ code })`",
        ),
        (
            r#"import { defineConfig, table, id, text } from "first";
const notes = table({ id: id(), title: text() });
export default defineConfig({ tables: { notes } });"#,
            "`id()` is gone",
            "delete `id: id()`",
        ),
        (
            r#"import { defineConfig, table, real } from "first";
const notes = table({ score: real() });
export default defineConfig({ tables: { notes } });"#,
            "`real()` is now `number()`",
            "number()",
        ),
        (
            r#"import { defineConfig, table, text } from "first";
const notes = table({ kind: text({ enum: ["a", "b"] }) });
export default defineConfig({ tables: { notes } });"#,
            "`text({ enum })` is now `select([...])`",
            "select(",
        ),
        (
            r#"import { defineConfig, table, select } from "first";
const notes = table({ kind: select({ options: ["a", "b"] }) });
export default defineConfig({ tables: { notes } });"#,
            "select() takes its options as an array",
            "select([",
        ),
        (
            r#"import { defineConfig, table, group, text } from "first";
const notes = table({ seo: group({ fields: { title: text() } }) });
export default defineConfig({ tables: { notes } });"#,
            "group() takes its fields directly",
            "group({",
        ),
        (
            r#"import { defineConfig, table, json } from "first";
const notes = table({ tags: json().$type<string[]>() });
export default defineConfig({ tables: { notes } });"#,
            "`json().$type<T>()` is now `json<T>()`",
            "json<string[]>()",
        ),
        (
            r#"import { defineConfig, table, text, integer } from "first";
const notes = table({ title: text() });
const links = table({ noteId: integer().references(() => notes.id) });
export default defineConfig({ tables: { notes, links } });"#,
            "`.references()` is gone",
            "ref(locations)",
        ),
        (
            r#"import { defineConfig, defineRelations, table, text } from "first";
const notes = table({ title: text() });
const relations = defineRelations({ notes }, () => ({}));
export default defineConfig({ tables: { notes }, relations });"#,
            "`defineRelations()` is gone",
            "ref(locations)",
        ),
        (
            r#"import { defineConfig, table, text } from "first";
const notes = table({ title: text() });
export default defineConfig({ tables: { notes }, relations: {} });"#,
            "`relations` is gone",
            "ref(locations)",
        ),
    ];
    for (config, message, help) in cases {
        let work = tempfile::tempdir().unwrap();
        fs::write(work.path().join("first.config.ts"), config).unwrap();
        let Err(error) = first::bundle::sources(work.path(), &work.path().join("captured")) else {
            panic!("a First project compiled a 0.3.0 form: {config}")
        };
        assert!(error.message.contains(message), "{config}\n{}", error.message);
        assert!(
            error.help.as_deref().unwrap_or_default().contains(help),
            "{config}\n{:?}",
            error.help
        );
    }
}
