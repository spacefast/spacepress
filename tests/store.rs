#![cfg(feature = "host")]
use std::{fs, path::Path};

fn copy(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if name == ".tp" || name == "node_modules" {
            continue;
        }
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &to.join(name));
        } else {
            fs::copy(entry.path(), to.join(name)).unwrap();
        }
    }
}

/// Capture pantry with its `consume` message changed to `label`.
fn capture(work: &Path, label: &str) -> std::path::PathBuf {
    // The app name comes from the directory name: both builds are of one app, `pantry`.
    let project = work.join(label).join("pantry");
    copy(Path::new("examples/pantry"), &project);
    let config = project.join("typedpress.config.ts");
    let text = fs::read_to_string(&config).unwrap();
    let changed = text.replace("left` };", &format!("left ({label})` }};"));
    assert_ne!(text, changed, "the fixture edit applies");
    fs::write(&config, changed).unwrap();
    let sources = work.join(format!("sources-{label}"));
    typedpress::host::sources(&project, &sources).unwrap();
    sources
}

fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<_> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn two_builds_share_one_runtime_tree_and_collect_only_unreferenced_trees() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("store");
    let one = capture(work.path(), "one");
    let two = capture(work.path(), "two");

    let first = typedpress::host::compile_to_store(&one, &root, &one, None).unwrap();
    let runtime = root.join("runtime").join(&first.runtime_revision);
    assert!(runtime.join("typedpress-runtime/typedpress-runtime.php").is_file());
    assert!(runtime.join("typedpress-identity/typedpress-identity.php").is_file());
    assert!(runtime.join("typedpress-loader.php").is_file());
    let app = root.join("app").join(&first.app_hash);
    assert!(app.join("plugins/typedpress-app-pantry/tp/app/functions.php").is_file());
    assert!(
        !app.join("plugins/typedpress-runtime").exists(),
        "the app tree holds no runtime copy"
    );
    assert_eq!(first.manifest.runtime, first.runtime_revision);
    assert_eq!(first.manifest.app, first.app_hash);
    assert!(app.join("snapshot.json").is_file());

    // The runtime tree is written once: its bytes keep their inode, so opcache paths stay valid.
    let marker = fs::metadata(runtime.join("typedpress-runtime/typedpress-runtime.php")).unwrap();
    let second = typedpress::host::compile_to_store(&two, &root, &two, Some(&first.build_id)).unwrap();
    assert_eq!(second.runtime_revision, first.runtime_revision);
    assert_ne!(second.app_hash, first.app_hash);
    assert_ne!(second.build_id, first.build_id);
    assert_eq!(entries(&root.join("runtime")), vec![first.runtime_revision.clone()]);
    assert_eq!(entries(&root.join("app")).len(), 2);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let after = fs::metadata(runtime.join("typedpress-runtime/typedpress-runtime.php")).unwrap();
        assert_eq!(after.ino(), marker.ino());
    }

    // Each build's action code is its own.
    let functions = |hash: &str| {
        fs::read_to_string(
            root.join("app")
                .join(hash)
                .join("plugins/typedpress-app-pantry/tp/app/functions.php"),
        )
        .unwrap()
    };
    assert!(functions(&first.app_hash).contains("(one)"));
    assert!(functions(&second.app_hash).contains("(two)"));

    // Same sources, same baseline: the same build, nothing new written.
    let again = typedpress::host::compile_to_store(&two, &root, &two, Some(&first.build_id)).unwrap();
    assert_eq!(again.build_id, second.build_id);
    assert_eq!(entries(&root.join("app")).len(), 2);
    assert_eq!(entries(&root.join(".tmp")), Vec::<String>::new());

    // A dry run reports and removes nothing.
    let doomed = typedpress::host::store_gc(&root, &[&second.build_id], true).unwrap();
    assert_eq!(
        doomed,
        vec![
            root.join("build").join(format!("{}.json", first.build_id)),
            root.join("app").join(&first.app_hash),
        ]
    );
    assert!(app.is_dir());
    let removed = typedpress::host::store_gc(&root, &[&second.build_id], false).unwrap();
    assert_eq!(removed, doomed);
    assert!(!app.exists());
    assert!(
        runtime.is_dir(),
        "the shared runtime stays while a kept build references it"
    );
    assert_eq!(entries(&root.join("build")), vec![format!("{}.json", second.build_id)]);

    // An unknown or tampered kept build fails instead of collecting around it.
    assert!(typedpress::host::store_gc(&root, &["0".repeat(64).as_str()], true).is_err());
    let manifest = root.join("build").join(format!("{}.json", second.build_id));
    let mut bytes = fs::read(&manifest).unwrap();
    bytes.push(b'\n');
    fs::write(&manifest, bytes).unwrap();
    assert!(typedpress::host::store_gc(&root, &[&second.build_id], true).is_err());
}

#[test]
fn a_failed_compile_leaves_the_store_unchanged() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("store");
    let sources = capture(work.path(), "bad");
    fs::write(sources.join("manifest.json"), "{}").unwrap();
    assert!(typedpress::host::compile_to_store(&sources, &root, &sources, None).is_err());
    for dir in ["runtime", "app", "build", ".tmp"] {
        assert_eq!(entries(&root.join(dir)), Vec::<String>::new(), "{dir}");
    }
}

/// Sealed mode (docs/sealed.md): a sealed app's build manifest lists the plugin directory slugs a
/// host lets load, so the host can enforce them before any plugin loads; an unsealed one has none.
#[test]
fn a_sealed_build_lists_the_plugins_a_host_lets_load() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("store");
    let plain = capture(work.path(), "plain");
    let built = typedpress::host::compile_to_store(&plain, &root, &plain, None).unwrap();
    assert_eq!(built.manifest.sealed, None);
    let manifest = fs::read_to_string(root.join("build").join(format!("{}.json", built.build_id))).unwrap();
    assert!(
        !manifest.contains("sealed"),
        "an unsealed build's manifest has no sealed key"
    );
    // Nor does the hosted manifest inside the app tree, so an unsealed app hashes as it did before.
    let hosted = fs::read_to_string(root.join("app").join(&built.app_hash).join("manifest.json")).unwrap();
    assert!(!hosted.contains("\"sealed\""), "{hosted}");

    let project = work.path().join("sealed").join("pantry");
    copy(Path::new("examples/pantry"), &project);
    let config = project.join("typedpress.config.ts");
    let text = fs::read_to_string(&config).unwrap();
    let sealed = text.replacen("defineConfig({", "defineConfig({\n  sealed: true,", 1);
    assert_ne!(text, sealed, "the fixture edit applies");
    fs::write(&config, sealed).unwrap();
    let sources = work.path().join("sources-sealed");
    typedpress::host::sources(&project, &sources).unwrap();
    let built = typedpress::host::compile_to_store(&sources, &root, &sources, None).unwrap();
    let listed = built.manifest.sealed.expect("a sealed build lists its plugins");
    // Exactly the plugins this host mounts for this app, plus the TypedPress plugin and TypedPress's admin
    // (always listed): no
    // identity (no users kind), no pages, no Polylang (no locales).
    assert_eq!(
        listed,
        [
            "action-scheduler",
            "mcp-adapter",
            "secure-custom-fields",
            "two-factor",
            "typedpress",
            "typedpress-admin",
            "typedpress-app-pantry",
            "typedpress-runtime"
        ]
    );
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("build").join(format!("{}.json", built.build_id))).unwrap())
            .unwrap();
    assert_eq!(manifest["sealed"], serde_json::json!(listed));
    // The hosted manifest in the app tree carries the same list.
    let hosted: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("app").join(&built.app_hash).join("manifest.json")).unwrap())
            .unwrap();
    assert_eq!(hosted["sealed"], serde_json::json!(listed));
    // The build loader accepts this manifest and a host reads the list from it; a manifest whose
    // list isn't plugin directory names is refused, like any other malformed manifest.
    let loader = root
        .join("runtime")
        .join(&built.runtime_revision)
        .join("typedpress-loader.php");
    let php = |code: &str| {
        let out = std::process::Command::new("php")
            .args(["-r", code])
            .arg(&loader)
            .arg(&root)
            .arg(&built.build_id)
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    let read = php(
        "define('ABSPATH', '/'); require $argv[1]; echo json_encode(TypedPress\\Loader\\Loader::sealed($argv[2], $argv[3]));",
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&read).unwrap(),
        serde_json::json!(listed)
    );
    let kept = php(
        "define('ABSPATH', '/'); require $argv[1]; $l = TypedPress\\Loader\\Loader::sealed($argv[2], $argv[3]);
         echo json_encode([TypedPress\\Loader\\Loader::allowedPlugins(['akismet/akismet.php', 'two-factor/two-factor.php', 'two-factor.php', 'two-factor/x/y.php', 'two-factor/../akismet/akismet.php', 7], $l),
            TypedPress\\Loader\\Loader::keepUnlisted(['two-factor/two-factor.php'], ['akismet/akismet.php', 'two-factor/two-factor.php', 'typedpress-runtime/typedpress-runtime.php'], $l)]);",
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&kept).unwrap(),
        serde_json::json!([
            ["two-factor/two-factor.php"],
            ["akismet/akismet.php", "two-factor/two-factor.php"]
        ])
    );
    // A plugin a sealed site never runs doesn't load even when the list a host holds names it.
    let denied = php(
        "define('ABSPATH', '/'); require $argv[1];
         echo json_encode(TypedPress\\Loader\\Loader::allowedPlugins(['vip-block-data-api/vip-block-data-api.php', 'vip-decoupled-bundle/vip-decoupled.php', 'two-factor/two-factor.php'], ['vip-block-data-api', 'vip-decoupled-bundle', 'two-factor']));",
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&denied).unwrap(),
        serde_json::json!(["two-factor/two-factor.php"])
    );
}

/// Each build keeps `baseline/<id>/` beside its app tree: the snapshot, the migrations and
/// `storage.json`, with each file's hash, so a lost app tree can be rebuilt. The manifest names the
/// baseline it was compiled against, its storage description, its jobs and its WordPress floor.
#[test]
fn every_build_keeps_a_baseline_and_describes_its_storage() {
    use sha2::{Digest, Sha256};
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("store");
    let one = capture(work.path(), "one");
    let two = capture(work.path(), "two");
    let first = typedpress::host::compile_to_store(&one, &root, &one, None).unwrap();
    let second = typedpress::host::compile_to_store(&two, &root, &two, Some(&first.build_id)).unwrap();
    assert_eq!(first.manifest.baseline, None);
    assert_eq!(second.manifest.baseline.as_deref(), Some(first.build_id.as_str()));
    assert_eq!(first.manifest.jobs, ["notifyLowStock"]);
    assert_eq!(
        first.manifest.wordpress.as_deref(),
        Some(typedpress::platform::WORDPRESS)
    );

    for built in [&first, &second] {
        let baseline = root.join("baseline").join(&built.build_id);
        let app = root.join("app").join(&built.app_hash);
        let hashes: serde_json::Map<String, serde_json::Value> =
            serde_json::from_slice(&fs::read(baseline.join("hashes.json")).unwrap()).unwrap();
        assert_eq!(
            hashes.keys().cloned().collect::<Vec<_>>(),
            ["migrations/0001_init.sql", "snapshot.json", "storage.json"]
        );
        for (rel, hash) in &hashes {
            let bytes = fs::read(baseline.join(rel)).unwrap();
            assert_eq!(bytes, fs::read(app.join(rel)).unwrap(), "{rel} is the app tree's");
            let digest: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
            assert_eq!(hash.as_str(), Some(digest.as_str()), "{rel}");
        }
        assert_eq!(
            built.manifest.storage.as_deref(),
            Some(format!("app/{}/storage.json", built.app_hash).as_str())
        );
    }
    // Only action code differs: both builds store the same things the same way.
    let storage = |built: &typedpress::store::StoredBuild| {
        fs::read(root.join("app").join(&built.app_hash).join("storage.json")).unwrap()
    };
    assert_eq!(storage(&first), storage(&second));

    let described: serde_json::Value = serde_json::from_slice(&storage(&first)).unwrap();
    assert_eq!(described["format"], "typedpress.storage.v1");
    let items = &described["kinds"]["items"];
    assert_eq!(items["in"], "table");
    assert_eq!(items["table"], "tp_items");
    assert_eq!(
        items["fields"]["slug"],
        serde_json::json!({ "at": { "column": "slug", "table": "tp_items" }, "max": 191.0, "required": true, "type": "text", "unique": true })
    );
    assert_eq!(items["fields"]["opened"]["default"], false);
    assert_eq!(
        items["indexes"],
        serde_json::json!([{ "columns": ["id"], "name": "PRIMARY", "unique": true }, { "columns": ["slug"], "name": "slug_unique", "unique": true }, { "columns": ["locationId"], "name": "tp_items_locationId_fk", "unique": false }])
    );
    assert_eq!(
        described["kinds"]["locations"]["fields"]["kind"]["choices"],
        serde_json::json!(["fridge", "freezer", "pantry"])
    );
    // Storage only: no access rules, actions, jobs or hooks.
    for key in ["access", "actions", "jobs", "hooks", "ui"] {
        assert!(
            !String::from_utf8(storage(&first))
                .unwrap()
                .contains(&format!("\"{key}\"")),
            "{key}"
        );
    }

    // Written once: compiling the same thing again leaves the baseline as it was.
    let marker = fs::metadata(root.join("baseline").join(&second.build_id).join("hashes.json")).unwrap();
    let again = typedpress::host::compile_to_store(&two, &root, &two, Some(&first.build_id)).unwrap();
    assert_eq!(again.build_id, second.build_id);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let after = fs::metadata(root.join("baseline").join(&second.build_id).join("hashes.json")).unwrap();
        assert_eq!(after.ino(), marker.ino());
    }
}

/// A manifest with the deployment fields loads in the build loader, whose `Store::manifest` checks
/// named keys only (unchanged since before these fields), and a manifest from before them still
/// reads here: they are optional.
#[test]
fn manifests_with_and_without_the_deployment_fields_load() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("store");
    let one = capture(work.path(), "one");
    let built = typedpress::host::compile_to_store(&one, &root, &one, None).unwrap();
    let loader = root
        .join("runtime")
        .join(&built.runtime_revision)
        .join("typedpress-loader.php");
    let out = std::process::Command::new("php")
        .args(["-r", "define('ABSPATH', '/'); require $argv[1]; echo json_encode(TypedPress\\Loader\\Store::manifest($argv[2], $argv[3])['jobs'] ?? null);"])
        .arg(&loader)
        .arg(&root)
        .arg(&built.build_id)
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "[\"notifyLowStock\"]",
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    // A manifest without the new fields, as the previous compiler wrote it, deserializes.
    let old = serde_json::json!({ "format": "typedpress.build.v1", "name": "pantry", "compiler": "0.3.0", "runtime": "a".repeat(64),
        "app": "b".repeat(64), "identity": false, "admin": true, "snapshot": "app/x/snapshot.json", "client": null });
    let manifest: typedpress::store::BuildManifest = serde_json::from_value(old).unwrap();
    assert_eq!(
        (manifest.baseline, manifest.storage, manifest.jobs, manifest.wordpress),
        (None, None, Vec::new(), None)
    );
}

/// A host marks a preview binding with `preview: true` in `Loader::load`; the runtime sees it before
/// the app mounts, and a build loaded without it is not a preview. Anything but a bool is refused.
#[test]
fn the_loader_tells_the_runtime_about_a_preview_binding() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("store");
    let one = capture(work.path(), "one");
    let built = typedpress::host::compile_to_store(&one, &root, &one, None).unwrap();
    let loader = root
        .join("runtime")
        .join(&built.runtime_revision)
        .join("typedpress-loader.php");
    // Before WordPress initializes: the loader only registers its mount for plugins_loaded.
    let load = |options: &str| {
        let code = format!(
            "define('ABSPATH', '/');
             function did_action($h) {{ return 0; }} function doing_action($h) {{ return false; }}
             function add_action(...$a) {{ return true; }} function add_filter(...$a) {{ return true; }}
             require $argv[1];
             try {{ TypedPress\\Loader\\Loader::load($argv[2], $argv[3], {options}); }}
             catch (InvalidArgumentException $e) {{ echo json_encode(['refused' => $e->getMessage()]); return; }}
             echo json_encode(['preview' => TypedPress\\Preview::on(), 'loaded' => TypedPress\\Loader\\Loader::loaded()['preview']]);"
        );
        let out = std::process::Command::new("php")
            .args(["-r", &code])
            .arg(&loader)
            .arg(&root)
            .arg(&built.build_id)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        serde_json::from_slice::<serde_json::Value>(&out.stdout).unwrap_or_else(|_| {
            panic!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            )
        })
    };
    assert_eq!(load("[]"), serde_json::json!({ "preview": false, "loaded": false }));
    assert_eq!(
        load("['preview' => true]"),
        serde_json::json!({ "preview": true, "loaded": true })
    );
    assert_eq!(
        load("['preview' => 'yes']"),
        serde_json::json!({ "refused": "preview must be true or false" })
    );
    assert_eq!(
        load("['preview' => null]"),
        serde_json::json!({ "refused": "preview must be true or false" })
    );
}

/// The TypedPress plugin publishes an uploaded tree only under the name its contents hash to
/// (runtime/typedpress-plugin/src/Trees.php). That hash must be the compiler's, or no upload would ever
/// be accepted: both are computed here over the same two stored trees.
#[test]
fn the_plugin_hashes_a_stored_tree_to_the_name_the_compiler_gave_it() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("store");
    let sources = capture(work.path(), "digest");
    let built = typedpress::host::compile_to_store(&sources, &root, &sources, None).unwrap();
    let digest = |dir: std::path::PathBuf| {
        let out = std::process::Command::new("php")
            .args([
                "-r",
                "require $argv[1]; echo TypedPressPlugin\\Trees::digest($argv[2]);",
                "runtime/typedpress-plugin/src/Trees.php",
            ])
            .arg(&dir)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8(out.stdout).unwrap()
    };
    assert_eq!(digest(root.join("app").join(&built.app_hash)), built.app_hash);
    assert_eq!(
        digest(root.join("runtime").join(&built.runtime_revision)),
        built.runtime_revision
    );
    // One changed byte is another tree.
    let app = root.join("app").join(&built.app_hash);
    fs::write(app.join("snapshot.json"), b"{}").unwrap();
    assert_ne!(digest(app), built.app_hash);
}
