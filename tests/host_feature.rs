#![cfg(feature = "host")]
use std::{fs, path::Path};

#[test]
fn host_capture_matches_native_bundle_bytes_and_compiles() {
    let work = tempfile::tempdir().unwrap();
    let host = work.path().join("host");
    let native = work.path().join("native");
    zero::host::sources(Path::new("examples/pantry"), &host).unwrap();
    zero::bundle::sources(Path::new("examples/pantry"), &native).unwrap();
    for name in ["app.zero.json", "vendor.zero.json", "manifest.json"] {
        assert_eq!(fs::read(host.join(name)).unwrap(), fs::read(native.join(name)).unwrap());
    }
    let result = zero::host::compile_sources(&host, &work.path().join("compiled"), &host, None).unwrap();
    assert_eq!(result["format"], "zero.hosted.v1");
    assert!(
        work.path()
            .join("compiled/plugins/zero-runtime/zero-runtime.php")
            .is_file()
    );
}

#[test]
fn host_capture_refuses_npm_before_resolution() {
    let work = tempfile::tempdir().unwrap();
    fs::write(
        work.path().join("zero.config.ts"),
        "import value from 'package-not-installed'; export default value;",
    )
    .unwrap();
    let error = zero::host::sources(work.path(), &work.path().join("source"))
        .err()
        .unwrap();
    assert_eq!(error.code, zero::diag::Code::SourceNeedsLocalCapture);
    assert!(!work.path().join("source").exists());
}

fn synced_project(root: &Path) {
    fs::create_dir_all(root.join("content/posts")).unwrap();
    fs::create_dir_all(root.join("content/items")).unwrap();
    fs::write(root.join("zero.config.ts"), "import { defineConfig, collection, table, id, text, richText } from 'zero'; const posts = collection({ id: id(), title: text().notNull(), body: richText() }, { title: 'title', content: 'body', sync: 'content/posts/*.md' }); const items = table({ id: id(), title: text() }, { sync: 'content/items/*.json' }); export default defineConfig({ collections: { posts }, tables: { items } });").unwrap();
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
    zero::host::sources(&project, &source).unwrap();
    fs::remove_dir_all(&project).unwrap();
    let output = work.path().join("compiled");
    zero::host::compile_sources(&source, &output, &source, None).unwrap();
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
    zero::host::sources(&project, &source).unwrap();
    let output = work.path().join("compiled");
    let error = zero::host::compile_sources(&source, &output, &source, None).unwrap_err();
    let rendered = zero::diag::render(&error, &source);
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
    let error = zero::host::sources(&project, &work.path().join("too-large"))
        .err()
        .unwrap();
    assert_eq!(error.code, zero::diag::Code::SyncFilesTooLarge);
    fs::remove_file(project.join("content/posts/large.md")).unwrap();
    #[cfg(unix)]
    {
        fs::write(work.path().join("outside.md"), "private").unwrap();
        std::os::unix::fs::symlink(work.path().join("outside.md"), project.join("content/posts/outside.md")).unwrap();
        assert!(zero::host::sources(&project, &work.path().join("escape")).is_err());
    }
}
