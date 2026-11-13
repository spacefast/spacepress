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

/// A 0.3.0 bundle that carries TSX pages, as their render artifact or as `pages/` sources, is
/// refused: First has no renderer for them, and compiling the rest would publish a site without
/// its pages.
#[test]
fn a_zero_source_bundle_with_rendered_pages_is_refused_with_how_to_publish_again() {
    for carried in ["zero/pages.json", "pages/page.tsx"] {
        refuses_with_pages(carried);
    }
}

fn refuses_with_pages(carried: &str) {
    let work = tempfile::tempdir().unwrap();
    let bundle = work.path().join("pages");
    copy_dir(&Path::new(FIXTURE).join("sources"), &bundle);
    let mut app: serde_json::Value = serde_json::from_slice(&fs::read(bundle.join("app.zero.json")).unwrap()).unwrap();
    app["files"][carried] = "{}".into();
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
    let error = first::bundle::compile(&bundle, &work.path().join("out"), &bundle, None).unwrap_err();
    assert!(error.message.contains("TSX pages"), "{carried}: {}", error.message);
    assert!(
        error
            .help
            .as_deref()
            .is_some_and(|h| h.contains("first/app/") && h.contains("first sources")),
        "{carried}: {:?}",
        error.help
    );
    assert!(!work.path().join("out").exists(), "{carried}: nothing is written");
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
