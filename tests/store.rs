#![cfg(feature = "host")]
use std::{fs, path::Path};

fn copy(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if name == ".zero" || name == "node_modules" {
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
    let config = project.join("zero.config.ts");
    let text = fs::read_to_string(&config).unwrap();
    let changed = text.replace("left` };", &format!("left ({label})` }};"));
    assert_ne!(text, changed, "the fixture edit applies");
    fs::write(&config, changed).unwrap();
    let sources = work.join(format!("sources-{label}"));
    zero::host::sources(&project, &sources).unwrap();
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

    let first = zero::host::compile_to_store(&one, &root, &one, None).unwrap();
    let runtime = root.join("runtime").join(&first.runtime_revision);
    assert!(runtime.join("zero-runtime/zero-runtime.php").is_file());
    assert!(runtime.join("zero-identity/zero-identity.php").is_file());
    let app = root.join("app").join(&first.app_hash);
    assert!(app.join("plugins/zero-app-pantry/zero/app/functions.php").is_file());
    assert!(
        !app.join("plugins/zero-runtime").exists(),
        "the app tree holds no runtime copy"
    );
    assert_eq!(first.manifest.runtime, first.runtime_revision);
    assert_eq!(first.manifest.app, first.app_hash);
    assert!(app.join("snapshot.json").is_file());

    // The runtime tree is written once: its bytes keep their inode, so opcache paths stay valid.
    let marker = fs::metadata(runtime.join("zero-runtime/zero-runtime.php")).unwrap();
    let second = zero::host::compile_to_store(&two, &root, &two, Some(&first.build_id)).unwrap();
    assert_eq!(second.runtime_revision, first.runtime_revision);
    assert_ne!(second.app_hash, first.app_hash);
    assert_ne!(second.build_id, first.build_id);
    assert_eq!(entries(&root.join("runtime")), vec![first.runtime_revision.clone()]);
    assert_eq!(entries(&root.join("app")).len(), 2);
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let after = fs::metadata(runtime.join("zero-runtime/zero-runtime.php")).unwrap();
        assert_eq!(after.ino(), marker.ino());
    }

    // Each build's action code is its own.
    let functions = |hash: &str| {
        fs::read_to_string(
            root.join("app")
                .join(hash)
                .join("plugins/zero-app-pantry/zero/app/functions.php"),
        )
        .unwrap()
    };
    assert!(functions(&first.app_hash).contains("(one)"));
    assert!(functions(&second.app_hash).contains("(two)"));

    // Same sources, same baseline: the same build, nothing new written.
    let again = zero::host::compile_to_store(&two, &root, &two, Some(&first.build_id)).unwrap();
    assert_eq!(again.build_id, second.build_id);
    assert_eq!(entries(&root.join("app")).len(), 2);
    assert_eq!(entries(&root.join(".tmp")), Vec::<String>::new());

    // A dry run reports and removes nothing.
    let doomed = zero::host::store_gc(&root, &[&second.build_id], true).unwrap();
    assert_eq!(
        doomed,
        vec![
            root.join("build").join(format!("{}.json", first.build_id)),
            root.join("app").join(&first.app_hash),
        ]
    );
    assert!(app.is_dir());
    let removed = zero::host::store_gc(&root, &[&second.build_id], false).unwrap();
    assert_eq!(removed, doomed);
    assert!(!app.exists());
    assert!(
        runtime.is_dir(),
        "the shared runtime stays while a kept build references it"
    );
    assert_eq!(entries(&root.join("build")), vec![format!("{}.json", second.build_id)]);

    // An unknown or tampered kept build fails instead of collecting around it.
    assert!(zero::host::store_gc(&root, &["0".repeat(64).as_str()], true).is_err());
    let manifest = root.join("build").join(format!("{}.json", second.build_id));
    let mut bytes = fs::read(&manifest).unwrap();
    bytes.push(b'\n');
    fs::write(&manifest, bytes).unwrap();
    assert!(zero::host::store_gc(&root, &[&second.build_id], true).is_err());
}

#[test]
fn a_failed_compile_leaves_the_store_unchanged() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path().join("store");
    let sources = capture(work.path(), "bad");
    fs::write(sources.join("manifest.json"), "{}").unwrap();
    assert!(zero::host::compile_to_store(&sources, &root, &sources, None).is_err());
    for dir in ["runtime", "app", "build", ".tmp"] {
        assert_eq!(entries(&root.join(dir)), Vec::<String>::new(), "{dir}");
    }
}
