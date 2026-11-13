#![cfg(feature = "host")]
use std::{fs, path::Path};

fn copy(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if name == ".first" || name == "node_modules" {
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
    let config = project.join("first.config.ts");
    let text = fs::read_to_string(&config).unwrap();
    let changed = text.replace("left` };", &format!("left ({label})` }};"));
    assert_ne!(text, changed, "the fixture edit applies");
    fs::write(&config, changed).unwrap();
    let sources = work.join(format!("sources-{label}"));
    first::host::sources(&project, &sources).unwrap();
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

    let first = first::host::compile_to_store(&one, &root, &one, None).unwrap();
    let runtime = root.join("runtime").join(&first.runtime_revision);
    assert!(runtime.join("first-runtime/first-runtime.php").is_file());
    assert!(runtime.join("first-identity/first-identity.php").is_file());
    assert!(runtime.join("first-loader.php").is_file());
    let app = root.join("app").join(&first.app_hash);
    assert!(app.join("plugins/first-app-pantry/first/app/functions.php").is_file());
    assert!(
        !app.join("plugins/first-runtime").exists(),
        "the app tree holds no runtime copy"
    );
    assert_eq!(first.manifest.runtime, first.runtime_revision);
    assert_eq!(first.manifest.app, first.app_hash);
    assert!(app.join("snapshot.json").is_file());

    // The runtime tree is written once: its bytes keep their inode, so opcache paths stay valid.
    let marker = fs::metadata(runtime.join("first-runtime/first-runtime.php")).unwrap();
    let second = first::host::compile_to_store(&two, &root, &two, Some(&first.build_id)).unwrap();
    assert_eq!(second.runtime_revision, first.runtime_revision);
    assert_ne!(second.app_hash, first.app_hash);
    assert_ne!(second.build_id, first.build_id);
    assert_eq!(entries(&root.join("runtime")), vec![first.runtime_revision.clone()]);
    assert_eq!(entries(&root.join("app")).len(), 2);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let after = fs::metadata(runtime.join("first-runtime/first-runtime.php")).unwrap();
        assert_eq!(after.ino(), marker.ino());
    }

    // Each build's action code is its own.
    let functions = |hash: &str| {
        fs::read_to_string(
            root.join("app")
                .join(hash)
                .join("plugins/first-app-pantry/first/app/functions.php"),
        )
        .unwrap()
    };
    assert!(functions(&first.app_hash).contains("(one)"));
    assert!(functions(&second.app_hash).contains("(two)"));

    // Same sources, same baseline: the same build, nothing new written.
    let again = first::host::compile_to_store(&two, &root, &two, Some(&first.build_id)).unwrap();
    assert_eq!(again.build_id, second.build_id);
    assert_eq!(entries(&root.join("app")).len(), 2);
    assert_eq!(entries(&root.join(".tmp")), Vec::<String>::new());

    // A dry run reports and removes nothing.
    let doomed = first::host::store_gc(&root, &[&second.build_id], true).unwrap();
    assert_eq!(
        doomed,
        vec![
            root.join("build").join(format!("{}.json", first.build_id)),
            root.join("app").join(&first.app_hash),
        ]
    );
    assert!(app.is_dir());
    let removed = first::host::store_gc(&root, &[&second.build_id], false).unwrap();
    assert_eq!(removed, doomed);
    assert!(!app.exists());
    assert!(
        runtime.is_dir(),
        "the shared runtime stays while a kept build references it"
    );
    assert_eq!(entries(&root.join("build")), vec![format!("{}.json", second.build_id)]);

    // An unknown or tampered kept build fails instead of collecting around it.
    assert!(first::host::store_gc(&root, &["0".repeat(64).as_str()], true).is_err());
    let manifest = root.join("build").join(format!("{}.json", second.build_id));
    let mut bytes = fs::read(&manifest).unwrap();
    bytes.push(b'\n');
    fs::write(&manifest, bytes).unwrap();
    assert!(first::host::store_gc(&root, &[&second.build_id], true).is_err());
}

#[test]
fn a_failed_compile_leaves_the_store_unchanged() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("store");
    let sources = capture(work.path(), "bad");
    fs::write(sources.join("manifest.json"), "{}").unwrap();
    assert!(first::host::compile_to_store(&sources, &root, &sources, None).is_err());
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
    let built = first::host::compile_to_store(&plain, &root, &plain, None).unwrap();
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
    let config = project.join("first.config.ts");
    let text = fs::read_to_string(&config).unwrap();
    let sealed = text.replacen("defineConfig({", "defineConfig({\n  sealed: true,", 1);
    assert_ne!(text, sealed, "the fixture edit applies");
    fs::write(&config, sealed).unwrap();
    let sources = work.path().join("sources-sealed");
    first::host::sources(&project, &sources).unwrap();
    let built = first::host::compile_to_store(&sources, &root, &sources, None).unwrap();
    let listed = built.manifest.sealed.expect("a sealed build lists its plugins");
    // Exactly the plugins this host mounts for this app: no identity (no users kind), no admin, no
    // pages, no Polylang (no locales).
    assert_eq!(
        listed,
        [
            "action-scheduler",
            "first-app-pantry",
            "first-runtime",
            "mcp-adapter",
            "secure-custom-fields",
            "two-factor"
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
        .join("first-loader.php");
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
        "define('ABSPATH', '/'); require $argv[1]; echo json_encode(First\\Loader\\Loader::sealed($argv[2], $argv[3]));",
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&read).unwrap(),
        serde_json::json!(listed)
    );
    let kept = php(
        "define('ABSPATH', '/'); require $argv[1]; $l = First\\Loader\\Loader::sealed($argv[2], $argv[3]);
         echo json_encode([First\\Loader\\Loader::allowedPlugins(['akismet/akismet.php', 'two-factor/two-factor.php', 'two-factor.php', 'two-factor/x/y.php', 'two-factor/../akismet/akismet.php', 7], $l),
            First\\Loader\\Loader::keepUnlisted(['two-factor/two-factor.php'], ['akismet/akismet.php', 'two-factor/two-factor.php', 'first-runtime/first-runtime.php'], $l)]);",
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&kept).unwrap(),
        serde_json::json!([
            ["two-factor/two-factor.php"],
            ["akismet/akismet.php", "two-factor/two-factor.php"]
        ])
    );
}
