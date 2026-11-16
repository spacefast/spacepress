#![cfg(feature = "host")]
use std::{fs, path::Path};

#[test]
fn host_capture_matches_native_bundle_bytes_and_compiles() {
    let work = tempfile::tempdir().unwrap();
    let host = work.path().join("host");
    let native = work.path().join("native");
    typedpress::host::sources(Path::new("examples/pantry"), &host).unwrap();
    typedpress::bundle::sources(Path::new("examples/pantry"), &native).unwrap();
    for name in ["app.typedpress.json", "vendor.typedpress.json", "manifest.json"] {
        assert_eq!(fs::read(host.join(name)).unwrap(), fs::read(native.join(name)).unwrap());
    }
    let result = typedpress::host::compile_sources(&host, &work.path().join("compiled"), &host, None).unwrap();
    assert_eq!(result["format"], "typedpress.hosted.v1");
    // What a host reads without opening TypedPress's generated files (docs/host-contract.md).
    assert_eq!(result["hostContract"], typedpress::host_contract::HOST_CONTRACT);
    assert_eq!(result["summary"]["name"], "pantry");
    assert_eq!(
        result["summary"]["tables"],
        serde_json::json!(["items", "locations", "shopping_list"])
    );
    assert_eq!(result["summary"]["collections"], result["summary"]["tables"]);
    assert!(
        result["summary"]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a == "consume"),
        "{}",
        result["summary"]
    );
    assert_eq!(result["host"]["mount"], "TypedPress\\Loader\\Loader::load");
    assert_eq!(result["host"]["jobsCommand"], "wp typedpress jobs tick");
    let written: serde_json::Value =
        serde_json::from_slice(&fs::read(work.path().join("compiled/manifest.json")).unwrap()).unwrap();
    assert_eq!(written, result, "the manifest file is what compile_sources returns");
    assert!(
        work.path()
            .join("compiled/plugins/typedpress-runtime/typedpress-runtime.php")
            .is_file()
    );
}

#[test]
fn host_capture_refuses_npm_before_resolution() {
    let work = tempfile::tempdir().unwrap();
    fs::write(
        work.path().join("typedpress.config.ts"),
        "import value from 'package-not-installed'; export default value;",
    )
    .unwrap();
    let error = typedpress::host::sources(work.path(), &work.path().join("source"))
        .err()
        .unwrap();
    assert_eq!(error.code, typedpress::diag::Code::SourceNeedsLocalCapture);
    assert!(!work.path().join("source").exists());
}

/// A hosted publish compiles from the captured sources alone: a `page.md` travels in the bundle,
/// and the compiled app plugin carries the page (its table entry and its Markdown).
#[test]
fn host_capture_carries_markdown_pages() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("app");
    fs::create_dir_all(project.join("tp/app/about")).unwrap();
    fs::write(
        project.join("typedpress.config.ts"),
        "import { defineConfig } from 'typedpress'; export default defineConfig({ name: 'mdsite' });",
    )
    .unwrap();
    fs::write(
        project.join("tp/app/layout.tsx"),
        "export default function Root({ children }: { children: JSX.Element }) { return <main>{children}</main>; }\n",
    )
    .unwrap();
    fs::write(
        project.join("tp/app/about/page.md"),
        "---\ntitle: About\n---\n\nWho we are.\n",
    )
    .unwrap();
    let source = work.path().join("source");
    typedpress::host::sources(&project, &source).unwrap();
    // The project is gone: only the bundle is left to compile from.
    fs::remove_dir_all(&project).unwrap();
    let compiled = work.path().join("compiled");
    typedpress::host::compile_sources(&source, &compiled, &source, None).unwrap();
    let app = compiled.join("plugins/typedpress-app-mdsite/tp/app");
    let php = |code: &str| {
        let out = std::process::Command::new("php").args(["-r", code]).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8(out.stdout).unwrap()
    };
    assert_eq!(
        php(&format!(
            "$s = require '{}'; $p = $s['app']['content']['/about']; echo $p['path'], '|', $p['title'], '|', $p['status'];",
            app.join("schema.php").display()
        )),
        "/about|About|publish"
    );
    assert_eq!(
        php(&format!(
            "$b = require '{}'; echo json_encode($b);",
            app.join("content.php").display()
        )),
        r#"{"\/about":"\nWho we are.\n"}"#
    );
}

fn synced_project(root: &Path) {
    fs::create_dir_all(root.join("content/posts")).unwrap();
    fs::create_dir_all(root.join("content/items")).unwrap();
    fs::write(root.join("typedpress.config.ts"), "import { defineConfig, collection, table, text, richText } from 'typedpress'; const posts = collection({ title: text(), body: richText().optional() }, { title: 'title', content: 'body', sync: 'content/posts/*.md' }); const items = table({ title: text().optional() }, { sync: 'content/items/*.json' }); export { posts }; export { items }; export default defineConfig({});").unwrap();
    fs::write(
        root.join("content/posts/hello.md"),
        "---\ntitle: Hello\n---\nA **seed**.\n",
    )
    .unwrap();
    fs::write(
        root.join("content/items/item.json"),
        r#"{"uid":"zr_00000000000000000001","title":"Explicit"}"#,
    )
    .unwrap();
    fs::write(root.join("content/posts/ignored.txt"), "not a sync input").unwrap();
}

#[test]
fn host_capture_seeds_synced_files_after_the_original_is_removed() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("app");
    synced_project(&project);
    let source = work.path().join("source");
    typedpress::host::sources(&project, &source).unwrap();
    fs::remove_dir_all(&project).unwrap();
    let output = work.path().join("compiled");
    typedpress::host::compile_sources(&source, &output, &source, None).unwrap();
    let posts: serde_json::Value = serde_json::from_slice(&fs::read(output.join("seed/posts.json")).unwrap()).unwrap();
    assert_eq!(
        posts,
        serde_json::json!({"collection":"posts","format":"md","records":[{
            "uid":"zr_34ccd108ad613ed735e1","fields":{"title":"Hello"},"body":"A **seed**.\n","path":"content/posts/hello.md"
        }]})
    );
    let items: serde_json::Value = serde_json::from_slice(&fs::read(output.join("seed/items.json")).unwrap()).unwrap();
    assert_eq!(
        items["records"],
        serde_json::json!([{"uid":"zr_00000000000000000001","fields":{"title":"Explicit"},"body":null,"path":"content/items/item.json"}])
    );
}

#[test]
fn invalid_synced_front_matter_reports_its_file_and_line_before_emitting() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("app");
    synced_project(&project);
    fs::write(
        project.join("content/posts/hello.md"),
        "---\ntitle: Hello\ntitle: Duplicate\n---\nBody\n",
    )
    .unwrap();
    let source = work.path().join("source");
    typedpress::host::sources(&project, &source).unwrap();
    let output = work.path().join("compiled");
    let error = typedpress::host::compile_sources(&source, &output, &source, None).unwrap_err();
    let rendered = typedpress::diag::render(&error, &source);
    assert!(rendered.contains("content/posts/hello.md:3:1"), "{rendered}");
    assert!(rendered.contains("duplicate key `title`"), "{rendered}");
    assert!(!output.exists());
}

#[test]
fn sync_capture_refuses_more_than_eight_mebibytes_and_escaping_files() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("app");
    synced_project(&project);
    fs::write(project.join("content/posts/large.md"), "x".repeat(8 * 1024 * 1024)).unwrap();
    let error = typedpress::host::sources(&project, &work.path().join("too-large"))
        .err()
        .unwrap();
    assert_eq!(error.code, typedpress::diag::Code::SyncFilesTooLarge);
    fs::remove_file(project.join("content/posts/large.md")).unwrap();
    #[cfg(unix)]
    {
        fs::write(work.path().join("outside.md"), "private").unwrap();
        std::os::unix::fs::symlink(work.path().join("outside.md"), project.join("content/posts/outside.md")).unwrap();
        assert!(typedpress::host::sources(&project, &work.path().join("escape")).is_err());
    }
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if name == ".tp" || name == "node_modules" {
            continue;
        }
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &to.join(&name));
        } else {
            fs::copy(entry.path(), to.join(&name)).unwrap();
        }
    }
}

fn tree(root: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
    let mut out = std::collections::BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.insert(
                    path.strip_prefix(root).unwrap().to_string_lossy().into_owned(),
                    fs::read(&path).unwrap(),
                );
            }
        }
    }
    out
}

/// examples/full-site's `tp/app/` pages, components, stylesheets and SVG travel in the app bundle as
/// sources, and the host compiler renders them from the app plugin after the project is gone.
#[test]
fn host_capture_of_a_pages_site_matches_native_and_renders_from_the_app_plugin() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("site");
    copy_tree(Path::new("examples/full-site"), &project);
    let host = work.path().join("host");
    let native = work.path().join("native");
    typedpress::host::sources(&project, &host).unwrap();
    typedpress::bundle::sources(&project, &native).unwrap();
    for name in ["app.typedpress.json", "vendor.typedpress.json", "manifest.json"] {
        assert_eq!(
            fs::read(host.join(name)).unwrap(),
            fs::read(native.join(name)).unwrap(),
            "{name}"
        );
    }
    let app: serde_json::Value = serde_json::from_slice(&fs::read(host.join("app.typedpress.json")).unwrap()).unwrap();
    for file in [
        "tp/app/layout.tsx",
        "tp/app/notes/[slug]/page.tsx",
        "tp/app/notes/[slug]/note.module.css",
        "tp/app/global.css",
        "tp/app/about/compass.svg",
        "tp/app/applause/page.tsx",
        "tp/components/CheerButton.tsx",
        "tp/components/NoteCard.tsx",
    ] {
        assert!(app["files"][file].is_string(), "{file} is captured");
    }
    fs::remove_dir_all(&project).unwrap();
    let compiled = work.path().join("compiled");
    let manifest = typedpress::host::compile_sources(&host, &compiled, &host, None).unwrap();
    assert_eq!(
        manifest.get("pages"),
        None,
        "no pages plugin: the app plugin renders tp/app/"
    );
    // The URLs outside /wp-json the app answers, so the host can hand them to WordPress: each
    // route with its method, and each page (GET and HEAD) in the same path grammar.
    assert_eq!(
        manifest["routes"],
        serde_json::json!([
            { "method": "GET", "path": "/api/feed.json" },
            { "method": "POST", "path": "/webhooks/stripe" }
        ])
    );
    assert_eq!(
        manifest["pagePaths"],
        serde_json::json!(["/", "/about", "/applause", "/notes", "/notes/:slug", "/notes/featured"])
    );
    let plugins: Vec<String> = fs::read_dir(compiled.join("plugins"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with("typedpress-pages"))
        .collect();
    assert_eq!(plugins, Vec::<String>::new());
    let app_plugin = tree(&compiled.join("plugins/typedpress-app-fullsite/tp/app"));
    let assets: Vec<String> = app_plugin
        .keys()
        .filter_map(|k| k.strip_prefix("assets/"))
        .map(|k| k.split('-').next().unwrap().to_string())
        .collect();
    assert_eq!(
        assets,
        [".htaccess", "compass", "global", "note"],
        "{:?}",
        app_plugin.keys()
    );
    let schema = String::from_utf8(app_plugin["schema.php"].clone()).unwrap();
    assert!(
        schema.contains("'app/api/feed.json/route.ts' => ['component' => null"),
        "{schema}"
    );
    assert!(
        schema.contains("'app/notes/[slug]/page.tsx' => ['component' =>"),
        "{schema}"
    );
}

/// A capture taken before `tp/app/`, holding TSX pages for the old renderer (`pages/` and
/// `tp/pages.json`), is refused on the host: compiling the rest would publish a site with no pages.
#[test]
fn a_capture_with_old_renderer_pages_is_refused_on_the_host() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("site");
    copy_tree(Path::new("examples/full-site"), &project);
    let captured = work.path().join("captured");
    typedpress::host::sources(&project, &captured).unwrap();
    for carried in ["tp/pages.json", "pages/page.tsx"] {
        let bundle = work.path().join(carried.replace('/', "-"));
        copy_tree(&captured, &bundle);
        let mut app: serde_json::Value =
            serde_json::from_slice(&fs::read(bundle.join("app.typedpress.json")).unwrap()).unwrap();
        app["files"][carried] = "{}".into();
        let bytes = serde_json::to_vec(&app).unwrap();
        fs::write(bundle.join("app.typedpress.json"), &bytes).unwrap();
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(bundle.join("manifest.json")).unwrap()).unwrap();
        manifest["app_sha256"] = {
            use sha2::Digest;
            sha2::Sha256::digest(&bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
                .into()
        };
        fs::write(bundle.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
        let out = work.path().join(format!("{}-out", carried.replace('/', "-")));
        let error = typedpress::host::compile_sources(&bundle, &out, &bundle, None).unwrap_err();
        assert!(
            error.message.contains("old pages renderer"),
            "{carried}: {}",
            error.message
        );
        assert!(
            error.help.as_deref().is_some_and(|h| h.contains("tp/app/")),
            "{carried}"
        );
        assert!(!out.exists(), "{carried}: nothing is written");
    }
}

/// A `tp/app/` route captures from source with no page artifact, and the host compile lists it
/// with its typed `req` (route shapes and refusals are tests/app_router.rs's).
#[test]
fn app_routes_capture_and_compile_on_the_host() {
    let work = tempfile::tempdir().unwrap();
    fs::create_dir_all(work.path().join("tp/app/api/[id]/feed.json")).unwrap();
    fs::write(
        work.path().join("typedpress.config.ts"),
        "import { defineConfig } from 'typedpress'; export default defineConfig({ name: 'r' });",
    )
    .unwrap();
    fs::write(
        work.path().join("tp/app/api/[id]/feed.json/route.ts"),
        "import type { RouteRequest } from 'typedpress';\nexport const access = 'anyone';\nexport async function GET(req: RouteRequest) { return { body: req.params['id'] + (req.query.get('k') ?? '') + req.query.getAll('k').join(',') }; }\n",
    )
    .unwrap();
    let out = work.path().join("src");
    typedpress::host::sources(work.path(), &out).expect("captures");
    let compiled = work.path().join("compiled");
    let manifest = typedpress::host::compile_sources(&out, &compiled, &out, None).expect("compiles");
    assert_eq!(
        manifest["routes"],
        serde_json::json!([{ "method": "GET", "path": "/api/:id/feed.json" }])
    );
}
