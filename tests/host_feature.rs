#![cfg(feature = "host")]
use std::{fs, path::Path};

#[test]
fn host_capture_matches_native_bundle_bytes_and_compiles() {
    let work = tempfile::tempdir().unwrap();
    let host = work.path().join("host");
    let native = work.path().join("native");
    first::host::sources(Path::new("examples/pantry"), &host).unwrap();
    first::bundle::sources(Path::new("examples/pantry"), &native).unwrap();
    for name in ["app.first.json", "vendor.first.json", "manifest.json"] {
        assert_eq!(fs::read(host.join(name)).unwrap(), fs::read(native.join(name)).unwrap());
    }
    let result = first::host::compile_sources(&host, &work.path().join("compiled"), &host, None).unwrap();
    assert_eq!(result["format"], "first.hosted.v1");
    // What a host reads without opening First's generated files (docs/host-contract.md).
    assert_eq!(result["hostContract"], first::host_contract::HOST_CONTRACT);
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
    assert_eq!(result["host"]["mount"], "First\\Loader\\Loader::load");
    assert_eq!(result["host"]["jobsCommand"], "wp first jobs tick");
    let written: serde_json::Value =
        serde_json::from_slice(&fs::read(work.path().join("compiled/manifest.json")).unwrap()).unwrap();
    assert_eq!(written, result, "the manifest file is what compile_sources returns");
    assert!(
        work.path()
            .join("compiled/plugins/first-runtime/first-runtime.php")
            .is_file()
    );
}

#[test]
fn host_capture_refuses_npm_before_resolution() {
    let work = tempfile::tempdir().unwrap();
    fs::write(
        work.path().join("first.config.ts"),
        "import value from 'package-not-installed'; export default value;",
    )
    .unwrap();
    let error = first::host::sources(work.path(), &work.path().join("source"))
        .err()
        .unwrap();
    assert_eq!(error.code, first::diag::Code::SourceNeedsLocalCapture);
    assert!(!work.path().join("source").exists());
}

fn synced_project(root: &Path) {
    fs::create_dir_all(root.join("content/posts")).unwrap();
    fs::create_dir_all(root.join("content/items")).unwrap();
    fs::write(root.join("first.config.ts"), "import { defineConfig, collection, table, id, text, richText } from 'first'; const posts = collection({ id: id(), title: text().notNull(), body: richText() }, { title: 'title', content: 'body', sync: 'content/posts/*.md' }); const items = table({ id: id(), title: text() }, { sync: 'content/items/*.json' }); export default defineConfig({ collections: { posts }, tables: { items } });").unwrap();
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
    first::host::sources(&project, &source).unwrap();
    fs::remove_dir_all(&project).unwrap();
    let output = work.path().join("compiled");
    first::host::compile_sources(&source, &output, &source, None).unwrap();
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
    first::host::sources(&project, &source).unwrap();
    let output = work.path().join("compiled");
    let error = first::host::compile_sources(&source, &output, &source, None).unwrap_err();
    let rendered = first::diag::render(&error, &source);
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
    let error = first::host::sources(&project, &work.path().join("too-large"))
        .err()
        .unwrap();
    assert_eq!(error.code, first::diag::Code::SyncFilesTooLarge);
    fs::remove_file(project.join("content/posts/large.md")).unwrap();
    #[cfg(unix)]
    {
        fs::write(work.path().join("outside.md"), "private").unwrap();
        std::os::unix::fs::symlink(work.path().join("outside.md"), project.join("content/posts/outside.md")).unwrap();
        assert!(first::host::sources(&project, &work.path().join("escape")).is_err());
    }
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if name == ".first" || name == "node_modules" {
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

/// The committed render artifact of examples/full-site (`first-pages build`) travels in the app bundle,
/// and the host compiler turns it into the pages plugin without JavaScript, after the project is gone.
#[test]
fn host_capture_of_a_pages_site_matches_native_and_emits_the_pages_plugin() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("site");
    copy_tree(Path::new("examples/full-site"), &project);
    let host = work.path().join("host");
    let native = work.path().join("native");
    first::host::sources(&project, &host).unwrap();
    first::bundle::sources(&project, &native).unwrap();
    for name in ["app.first.json", "vendor.first.json", "manifest.json"] {
        assert_eq!(
            fs::read(host.join(name)).unwrap(),
            fs::read(native.join(name)).unwrap(),
            "{name}"
        );
    }
    let app: serde_json::Value = serde_json::from_slice(&fs::read(host.join("app.first.json")).unwrap()).unwrap();
    for file in [
        "first/pages.json",
        "pages/notes/[slug]/page.tsx",
        "islands/cheer.client.ts",
        "styles/global.css",
        "pages/about/compass.svg",
    ] {
        assert!(app["files"][file].is_string(), "{file} is captured");
    }
    fs::remove_dir_all(&project).unwrap();
    let compiled = work.path().join("compiled");
    let manifest = first::host::compile_sources(&host, &compiled, &host, None).unwrap();
    assert_eq!(manifest["pages"], "first-pages-fullsite");
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
        serde_json::json!(["/", "/about", "/notes", "/notes/:item", "/notes/featured"])
    );
    let plugin = tree(&compiled.join("plugins/first-pages-fullsite"));
    let artifact: serde_json::Value = serde_json::from_str(app["files"]["first/pages.json"].as_str().unwrap()).unwrap();
    assert_eq!(
        plugin["manifest.json"],
        artifact["manifest"].as_str().unwrap().as_bytes()
    );
    for name in artifact["files"].as_object().unwrap().keys() {
        assert!(plugin.contains_key(name), "{name}");
    }
    for php in [
        "first-pages-fullsite.php",
        "first-pages/Plugin.php",
        "first-pages/Routes.php",
        "first-pages/Renderer.php",
        "first-pages/Request.php",
        "first-pages/bootstrap.php",
    ] {
        assert!(plugin.contains_key(php), "{php}");
    }
    assert_eq!(
        plugin["first-pages/Plugin.php"],
        fs::read("runtime/pages/Plugin.php").unwrap(),
        "the pages runtime is the embedded runtime/pages"
    );
    let schema =
        String::from_utf8(fs::read(compiled.join("plugins/first-app-fullsite/first/app/schema.php")).unwrap()).unwrap();
    assert!(
        schema.contains("'feed' => ['method' => 'GET', 'path' => '/api/feed.json'"),
        "{schema}"
    );
}

fn pages_project(work: &Path) -> std::path::PathBuf {
    let project = work.join("site");
    copy_tree(Path::new("examples/full-site"), &project);
    project
}

fn refused(project: &Path, out: &Path) -> first::diag::Diag {
    first::host::sources(project, out).err().expect("capture refuses")
}

#[test]
fn a_stale_or_missing_render_artifact_is_refused_before_publishing() {
    let work = tempfile::tempdir().unwrap();
    let project = pages_project(work.path());
    let page = project.join("pages/about/page.tsx");
    let original = fs::read_to_string(&page).unwrap();
    fs::write(&page, original.replace("About", "About us")).unwrap();
    let error = refused(&project, &work.path().join("a"));
    assert_eq!(error.code, first::diag::Code::SourceNeedsLocalCapture);
    assert!(
        error.message.contains("pages/about/page.tsx changed"),
        "{}",
        error.message
    );
    fs::write(&page, original).unwrap();

    fs::create_dir_all(project.join("pages/contact")).unwrap();
    fs::write(
        project.join("pages/contact/page.tsx"),
        "export default () => <p>Hi</p>;\n",
    )
    .unwrap();
    assert!(
        refused(&project, &work.path().join("b"))
            .message
            .contains("pages/contact/page.tsx was added")
    );
    fs::remove_dir_all(project.join("pages/contact")).unwrap();

    let config = project.join("first.config.ts");
    let text = fs::read_to_string(&config).unwrap();
    fs::write(
        &config,
        text.replace(
            "dek: text({ multiline: true }).max(240),",
            "dek: text({ multiline: true }).max(240),\n  mood: text(),",
        ),
    )
    .unwrap();
    assert!(
        refused(&project, &work.path().join("c"))
            .message
            .contains("different schema")
    );
    fs::write(&config, text).unwrap();

    fs::remove_file(project.join("first/pages.json")).unwrap();
    assert_eq!(
        refused(&project, &work.path().join("d")).code,
        first::diag::Code::SourceNeedsLocalCapture
    );
    assert!(!work.path().join("d").exists());
}

#[test]
fn a_tampered_render_artifact_cannot_carry_php_or_escape_the_plugin() {
    let work = tempfile::tempdir().unwrap();
    let project = pages_project(work.path());
    let path = project.join("first/pages.json");
    let original: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    for (name, contents) in [
        ("assets/x.php", "PD9waHA="),
        ("first-pages/Plugin.php", "PD9waHA="),
        ("assets/../../x.css", "eA=="),
        ("assets/a.css", "!!"),
    ] {
        let mut artifact = original.clone();
        artifact["files"][name] = contents.into();
        fs::write(&path, serde_json::to_vec(&artifact).unwrap()).unwrap();
        let error = refused(&project, &work.path().join("out"));
        assert!(
            error.message.contains("invalid first/pages.json"),
            "{name}: {}",
            error.message
        );
    }
    let mut artifact = original.clone();
    let mut manifest: serde_json::Value = serde_json::from_str(artifact["manifest"].as_str().unwrap()).unwrap();
    manifest["routes"][0]["id"] = "first:not-found".into();
    manifest["routes"][0]["pattern"] = "/category/news".into();
    artifact["manifest"] = manifest.to_string().into();
    fs::write(&path, serde_json::to_vec(&artifact).unwrap()).unwrap();
    assert!(
        refused(&project, &work.path().join("out"))
            .message
            .contains("not-found identity")
    );
    let mut artifact = original.clone();
    let mut manifest: serde_json::Value = serde_json::from_str(artifact["manifest"].as_str().unwrap()).unwrap();
    manifest["routes"][0]["pattern"] = "/wp-admin".into();
    artifact["manifest"] = manifest.to_string().into();
    fs::write(&path, serde_json::to_vec(&artifact).unwrap()).unwrap();
    assert!(
        refused(&project, &work.path().join("out"))
            .message
            .contains("route pattern")
    );
}

#[test]
fn routes_declare_one_method_and_a_path_that_wordpress_does_not_own() {
    let work = tempfile::tempdir().unwrap();
    let check = |routes: &str| {
        fs::write(
            work.path().join("first.config.ts"),
            format!("import {{ defineConfig, route }} from 'first'; export default defineConfig({{ name: 'r', routes: {{ {routes} }} }});"),
        )
        .unwrap();
        first::host::sources(work.path(), &work.path().join(format!("o{}", rand_suffix())))
            .map(|_| ())
            .map_err(|e| e.message)
    };
    let ok = "a: route({ method: 'GET', path: '/api/:id/feed.json', access: 'anyone', handler: (req) => ({ body: req.params['id'] + (req.query.get('k') ?? '') + req.query.getAll('k').join(',') }) })";
    assert_eq!(check(ok), Ok(()));
    for (routes, message) in [
        (
            "a: route({ method: 'GET', path: '/wp-json/x', access: 'anyone', handler: () => ({}) })",
            "owns",
        ),
        (
            "a: route({ method: 'GET', path: 'api', access: 'anyone', handler: () => ({}) })",
            "must start with /",
        ),
        (
            "a: route({ method: 'TRACE', path: '/x', access: 'anyone', handler: () => ({}) })",
            "not supported",
        ),
        (
            "a: route({ method: 'GET', path: '/x', handler: () => ({}) })",
            "needs access or signature",
        ),
        (
            "a: route({ method: 'GET', path: '/x/:a', access: 'anyone', handler: () => ({}) }), b: route({ method: 'GET', path: '/x/:b', access: 'anyone', handler: () => ({}) })",
            "both match",
        ),
        (
            "a: route({ method: 'GET', path: '/x', access: 'anyone', handler: () => ({ status: 'ok' }) })",
            "not a route response",
        ),
        (
            "a: route({ method: 'GET', path: '/x', access: 'anyone', handler: (req) => ({ body: req.query['k'] }) })",
            "has no field `k`",
        ),
    ] {
        let error = check(routes).unwrap_err();
        assert!(error.contains(message), "{routes}: {error}");
    }
}

fn rand_suffix() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    N.fetch_add(1, Ordering::Relaxed)
}

#[test]
fn a_route_cannot_take_a_page_url() {
    let work = tempfile::tempdir().unwrap();
    let project = pages_project(work.path());
    let config = project.join("first.config.ts");
    let text = fs::read_to_string(&config).unwrap();
    fs::write(
        &config,
        text.replace("path: \"/api/feed.json\"", "path: \"/notes/:id\""),
    )
    .unwrap();
    let error = refused(&project, &work.path().join("out"));
    assert!(error.message.contains("can match a URL the page"), "{}", error.message);
    // A literal path under an item route is a URL that route serves, whatever the method.
    fs::write(
        &config,
        text.replace("path: \"/api/feed.json\"", "path: \"/notes/hello\"")
            .replace(
                "method: \"GET\",\n      path: \"/notes/hello\"",
                "method: \"POST\",\n      path: \"/notes/hello\"",
            ),
    )
    .unwrap();
    assert!(
        refused(&project, &work.path().join("out2"))
            .message
            .contains("can match a URL the page")
    );
}
