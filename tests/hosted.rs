#![cfg(feature = "cli")]

use std::{fs, path::Path};

fn write(root: &Path, path: &str, content: &str) {
    let target = root.join(path);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, content).unwrap();
}

#[test]
fn captured_installed_sources_compile_after_the_checkout_is_gone_and_keep_version_outputs() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("app");
    write(
        &project,
        "spacepress.config.ts",
        "import { defineConfig, f, global, mutation } from 'spacepress'; import { message } from './sp/message'; import { suffix } from 'shared'; const __settings = global({ label: f.text().default('Ready') }); export { __settings as settings }; const __version = mutation({ access: 'anyone' }, () => { return message + suffix; }); export { __version as version }; export default defineConfig({});",
    );
    write(&project, "sp/message.ts", "export const message = 'v1';");
    write(
        &project,
        "node_modules/shared/package.json",
        r#"{"type":"module","exports":"./index.js"}"#,
    );
    write(
        &project,
        "node_modules/shared/index.js",
        "export const suffix = '-installed';",
    );
    write(&project, "public/logo.svg", "<svg/>");
    write(
        &project,
        "sp/_generated/migrations/0001_adopt.sql",
        "SELECT 'archived only';",
    );
    write(
        &project,
        "sp/_generated/migrations/snapshot.json",
        r#"{"version":2,"tables":{}}"#,
    );
    write(&project, "unrelated.ts", "this is not an input");
    let first = work.path().join("sp");
    let sources = spacepress::bundle::sources(&project, &first).unwrap();
    let vendor = fs::read(first.join("vendor.spacepress.json")).unwrap();
    let captured: spacepress::bundle::SourceBundle = serde_json::from_slice(&vendor).unwrap();
    assert!(captured.files.contains_key("node_modules/shared/index.js"));
    let app: spacepress::bundle::SourceBundle =
        serde_json::from_slice(&fs::read(first.join("app.spacepress.json")).unwrap()).unwrap();
    assert!(!app.files.contains_key("unrelated.ts"));
    write(&project, "sp/message.ts", "export const message = 'v2';");
    let second = work.path().join("second");
    let later = spacepress::bundle::sources(&project, &second).unwrap();
    assert_eq!(sources.vendor_sha256, later.vendor_sha256);
    assert_ne!(sources.app_sha256, later.app_sha256);
    assert_eq!(vendor, fs::read(second.join("vendor.spacepress.json")).unwrap());
    fs::remove_dir_all(&project).unwrap();
    let compiled_first = work.path().join("compiled-first");
    let compiled_second = work.path().join("compiled-second");
    let manifest = spacepress::bundle::compile(&first, &compiled_first, &first, None).unwrap();
    assert_eq!(manifest["compiler"], spacepress::bundle::VERSION);
    assert_eq!(
        fs::read_to_string(compiled_first.join("source-migrations/0001_adopt.sql")).unwrap(),
        "SELECT 'archived only';"
    );
    assert_eq!(
        fs::read_to_string(compiled_first.join("source-migrations/snapshot.json")).unwrap(),
        r#"{"version":2,"tables":{}}"#
    );
    // Refuse a capture with a ledger outside the current path.
    let older = work.path().join("older");
    fs::create_dir(&older).unwrap();
    fs::copy(
        first.join("vendor.spacepress.json"),
        older.join("vendor.spacepress.json"),
    )
    .unwrap();
    let mut app: serde_json::Value =
        serde_json::from_slice(&fs::read(first.join("app.spacepress.json")).unwrap()).unwrap();
    let files = app["files"].as_object_mut().unwrap();
    for name in ["0001_adopt.sql", "snapshot.json"] {
        let text = files.remove(&format!("sp/_generated/migrations/{name}")).unwrap();
        files.insert(format!("sp/migrations/{name}"), text);
    }
    let app = serde_json::to_vec(&app).unwrap();
    fs::write(older.join("app.spacepress.json"), &app).unwrap();
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(first.join("manifest.json")).unwrap()).unwrap();
    manifest["app_sha256"] = {
        use sha2::Digest;
        sha2::Sha256::digest(&app)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
            .into()
    };
    fs::write(older.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    let compiled_older = work.path().join("compiled-older");
    let refusal = spacepress::bundle::compile(&older, &compiled_older, &older, None).unwrap_err();
    assert!(refusal.message.contains("sp/migrations/ moved"), "{refusal:?}");
    assert!(!compiled_older.exists());
    let path = "plugins/spacepress-app-app/sp/app/functions.php";
    let before = fs::read(compiled_first.join(path)).unwrap();
    let compiled = std::process::Command::new(env!("CARGO_BIN_EXE_spacepress"))
        .arg("compile-sources")
        .arg(&second)
        .arg(&compiled_second)
        .arg(&second)
        .arg(&compiled_first)
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    assert_ne!(before, fs::read(compiled_second.join(path)).unwrap());
    assert_eq!(before, fs::read(compiled_first.join(path)).unwrap());
    assert!(spacepress::bundle::compile(&second, &compiled_first, &second, None).is_err());
    let client_before = fs::read(compiled_first.join("client/client.js")).unwrap();
    assert!(client_before.len() > 1000);
    assert!(fs::metadata(compiled_first.join("client/client.d.ts")).unwrap().len() > 1000);
    write(
        work.path(),
        "client.ts",
        r#"import { createClient } from './compiled-first/client/client.js';
const client = createClient();
const label: Promise<string> = client.globals.settings.get().then(settings => settings.label);
const version: Promise<string> = client.actions.version();
client.globals.settings.update({ label: 'Updated' });
// @ts-expect-error global labels must be strings
client.globals.settings.update({ label: 1 });
void label; void version;
"#,
    );
    let types = std::process::Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .args([
            "--strict",
            "--noEmit",
            "--target",
            "ES2022",
            "--module",
            "ESNext",
            "--moduleResolution",
            "bundler",
            "--lib",
            "ES2022,DOM",
        ])
        .arg(work.path().join("client.ts"))
        .output()
        .expect("tsc (or TSC) must be installed to check generated clients");
    assert!(
        types.status.success(),
        "hosted client contract failed: {}{}",
        String::from_utf8_lossy(&types.stdout),
        String::from_utf8_lossy(&types.stderr)
    );
    fs::write(second.join("vendor.spacepress.json"), b"{}").unwrap();
    let error = spacepress::bundle::compile(&second, &work.path().join("tampered"), &second, None).unwrap_err();
    assert!(error.message.contains("hash mismatch"));
    assert_eq!(
        fs::read(compiled_first.join("plugins/spacepress-app-app/public/logo.svg")).unwrap(),
        b"<svg/>"
    );
}

#[test]
fn hosted_sources_refuse_php_and_external_symlinks() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("app");
    write(
        &project,
        "spacepress.config.ts",
        "import { defineConfig } from 'spacepress'; export default defineConfig({});",
    );
    write(&project, "public/nested/unsafe.PHP", "<?php echo 'no';");
    let upload = work.path().join("upload");
    assert!(spacepress::bundle::sources(&project, &upload).is_err());
    assert!(!upload.exists());
    fs::remove_dir_all(project.join("public")).unwrap();
    let bundle = work.path().join("bundle");
    spacepress::bundle::sources(&project, &bundle).unwrap();
    write(&bundle, "public/nested/unsafe.PHP", "<?php echo 'no';");
    let output = work.path().join("compiled");
    assert!(spacepress::bundle::compile(&bundle, &output, &bundle, None).is_err());
    assert!(!output.exists());
    fs::remove_dir_all(bundle.join("public")).unwrap();
    #[cfg(unix)]
    {
        fs::create_dir(bundle.join("public")).unwrap();
        write(work.path(), "outside.txt", "private");
        std::os::unix::fs::symlink(work.path().join("outside.txt"), bundle.join("public/linked.txt")).unwrap();
        assert!(spacepress::bundle::compile(&bundle, &output, &bundle, None).is_err());
        assert!(!output.exists());
        fs::remove_dir_all(bundle.join("public")).unwrap();
        std::os::unix::fs::symlink(&project, bundle.join("public")).unwrap();
        assert!(spacepress::bundle::compile(&bundle, &output, &bundle, None).is_err());
        assert!(!output.exists());
        write(work.path(), "outside.ts", "export const value = 1;");
        std::os::unix::fs::symlink(work.path().join("outside.ts"), project.join("outside.ts")).unwrap();
        write(
            &project,
            "spacepress.config.ts",
            "import { defineConfig } from 'spacepress'; import { value } from './outside'; export default defineConfig({ name: String(value) });",
        );
        assert!(spacepress::bundle::sources(&project, &work.path().join("escape")).is_err());
    }
}

/// Hosted compiles enforce the same import fence as checkouts.
#[test]
fn hosted_bundles_enforce_the_import_fence() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("app");
    write(
        &project,
        "spacepress.config.ts",
        "import { defineConfig, mutation } from 'spacepress'; import { message } from './sp/message'; export const hello = mutation({ access: 'anyone' }, () => { return message; }); export default defineConfig({});",
    );
    write(&project, "sp/message.ts", "export const message = 'kept';");
    let bundle = work.path().join("bundle");
    spacepress::bundle::sources(&project, &bundle).unwrap();
    // Rewrite the capture so the helper sits at the project root, outside sp/.
    let app = bundle.join(spacepress::bundle::APP_FILE);
    let mut captured: serde_json::Value = serde_json::from_slice(&fs::read(&app).unwrap()).unwrap();
    let old = |s: &str| {
        s.replace("sp/message.ts", "lib/message.ts")
            .replace("./sp/message", "./lib/message")
    };
    for map in ["files", "canonical"] {
        let entries = captured[map].as_object_mut().unwrap();
        let moved: Vec<(String, serde_json::Value)> = std::mem::take(entries)
            .into_iter()
            .map(|(k, v)| (old(&k), v.as_str().map_or(v.clone(), |s| old(s).into())))
            .collect();
        entries.extend(moved);
    }
    assert!(captured["files"].get("lib/message.ts").is_some(), "{captured}");
    let bytes = serde_json::to_vec(&captured).unwrap();
    fs::write(&app, &bytes).unwrap();
    let manifest_path = bundle.join(spacepress::bundle::MANIFEST_FILE);
    let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    use sha2::Digest as _;
    manifest["app_sha256"] = sha2::Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
        .into();
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    fs::remove_dir_all(&project).unwrap();
    let compiled = work.path().join("compiled");
    let refusal = spacepress::bundle::compile(&bundle, &compiled, &bundle, None).unwrap_err();
    assert!(refusal.message.contains("outside sp/"), "{refusal:?}");
    assert!(!compiled.exists());
}

/// A hosted compile types `abilities.call` from the captured `sp/_generated/abilities.json`: the bundle's
/// file system is rooted at its own module directory, not at the app's name.
#[test]
fn captured_ability_lock_types_hosted_calls() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("calls");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/abilities-call");
    for file in ["spacepress.config.ts", "sp/_generated/abilities.json"] {
        write(&project, file, &fs::read_to_string(fixture.join(file)).unwrap());
    }
    let bundle = work.path().join("bundle");
    spacepress::bundle::sources(&project, &bundle).unwrap();
    fs::remove_dir_all(&project).unwrap();
    // Without the lock the call is `unknown ability \`acme/site-info\``, so compiling is the proof.
    let compiled = work.path().join("compiled");
    if let Err(e) = spacepress::bundle::compile(&bundle, &compiled, &bundle, None) {
        panic!("{}", e.message);
    }
    // A captured lock must be at the current path.
    let app = bundle.join(spacepress::bundle::APP_FILE);
    let mut captured: serde_json::Value = serde_json::from_slice(&fs::read(&app).unwrap()).unwrap();
    for map in ["files", "canonical"] {
        let entries = captured[map].as_object_mut().unwrap();
        let moved: Vec<(String, serde_json::Value)> = std::mem::take(entries)
            .into_iter()
            .map(|(k, v)| {
                let k = k.replace("sp/_generated/abilities.json", "sp/abilities.json");
                let v = match v {
                    serde_json::Value::String(s) => {
                        s.replace("sp/_generated/abilities.json", "sp/abilities.json").into()
                    }
                    v => v,
                };
                (k, v)
            })
            .collect();
        entries.extend(moved);
    }
    assert!(captured["files"].get("sp/abilities.json").is_some(), "{captured}");
    let bytes = serde_json::to_vec(&captured).unwrap();
    fs::write(&app, &bytes).unwrap();
    let manifest_path = bundle.join(spacepress::bundle::MANIFEST_FILE);
    let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    use sha2::Digest as _;
    manifest["app_sha256"] = sha2::Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
        .into();
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let older = work.path().join("compiled-older");
    let refusal = spacepress::bundle::compile(&bundle, &older, &bundle, None).unwrap_err();
    assert!(refusal.message.contains("sp/abilities.json moved"), "{refusal:?}");
    assert!(!older.exists());
}
