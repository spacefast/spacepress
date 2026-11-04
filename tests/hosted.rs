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
        "zero.config.ts",
        "import { defineConfig, action, global, text } from 'zero'; import { message } from './src/message'; import { suffix } from 'shared'; export default defineConfig({ globals: { settings: global('settings', { label: text().notNull().default('Ready') }) }, actions: { version: action({ access: 'anyone', handler() { return message + suffix; } }) } });",
    );
    write(&project, "src/message.ts", "export const message = 'v1';");
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
    write(&project, "zero/migrations/0001_adopt.sql", "SELECT 'archived only';");
    write(
        &project,
        "zero/migrations/snapshot.json",
        r#"{"version":2,"tables":{}}"#,
    );
    write(&project, "unrelated.ts", "this is not an input");
    let first = work.path().join("first");
    let sources = zero::bundle::sources(&project, &first).unwrap();
    let vendor = fs::read(first.join("vendor.zero.json")).unwrap();
    let captured: zero::bundle::SourceBundle = serde_json::from_slice(&vendor).unwrap();
    assert!(captured.files.contains_key("node_modules/shared/index.js"));
    let app: zero::bundle::SourceBundle =
        serde_json::from_slice(&fs::read(first.join("app.zero.json")).unwrap()).unwrap();
    assert!(!app.files.contains_key("unrelated.ts"));
    write(&project, "src/message.ts", "export const message = 'v2';");
    let second = work.path().join("second");
    let later = zero::bundle::sources(&project, &second).unwrap();
    assert_eq!(sources.vendor_sha256, later.vendor_sha256);
    assert_ne!(sources.app_sha256, later.app_sha256);
    assert_eq!(vendor, fs::read(second.join("vendor.zero.json")).unwrap());
    fs::remove_dir_all(&project).unwrap();
    let compiled_first = work.path().join("compiled-first");
    let compiled_second = work.path().join("compiled-second");
    let manifest = zero::bundle::compile(&first, &compiled_first, &first, None).unwrap();
    assert_eq!(manifest["compiler"], zero::bundle::VERSION);
    assert_eq!(
        fs::read_to_string(compiled_first.join("source-migrations/0001_adopt.sql")).unwrap(),
        "SELECT 'archived only';"
    );
    assert_eq!(
        fs::read_to_string(compiled_first.join("source-migrations/snapshot.json")).unwrap(),
        r#"{"version":2,"tables":{}}"#
    );
    let path = "plugins/zero-app-app/zero/app/functions.php";
    let before = fs::read(compiled_first.join(path)).unwrap();
    let compiled = std::process::Command::new(env!("CARGO_BIN_EXE_zero"))
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
    assert!(zero::bundle::compile(&second, &compiled_first, &second, None).is_err());
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
    fs::write(second.join("vendor.zero.json"), b"{}").unwrap();
    let error = zero::bundle::compile(&second, &work.path().join("tampered"), &second, None).unwrap_err();
    assert!(error.message.contains("hash mismatch"));
    assert_eq!(
        fs::read(compiled_first.join("plugins/zero-app-app/public/logo.svg")).unwrap(),
        b"<svg/>"
    );
}

#[test]
fn hosted_sources_refuse_php_and_external_symlinks() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("app");
    write(
        &project,
        "zero.config.ts",
        "import { defineConfig } from 'zero'; export default defineConfig({});",
    );
    write(&project, "public/nested/unsafe.PHP", "<?php echo 'no';");
    let upload = work.path().join("upload");
    assert!(zero::bundle::sources(&project, &upload).is_err());
    assert!(!upload.exists());
    fs::remove_dir_all(project.join("public")).unwrap();
    let bundle = work.path().join("bundle");
    zero::bundle::sources(&project, &bundle).unwrap();
    write(&bundle, "public/nested/unsafe.PHP", "<?php echo 'no';");
    let output = work.path().join("compiled");
    assert!(zero::bundle::compile(&bundle, &output, &bundle, None).is_err());
    assert!(!output.exists());
    fs::remove_dir_all(bundle.join("public")).unwrap();
    #[cfg(unix)]
    {
        fs::create_dir(bundle.join("public")).unwrap();
        write(work.path(), "outside.txt", "private");
        std::os::unix::fs::symlink(work.path().join("outside.txt"), bundle.join("public/linked.txt")).unwrap();
        assert!(zero::bundle::compile(&bundle, &output, &bundle, None).is_err());
        assert!(!output.exists());
        fs::remove_dir_all(bundle.join("public")).unwrap();
        std::os::unix::fs::symlink(&project, bundle.join("public")).unwrap();
        assert!(zero::bundle::compile(&bundle, &output, &bundle, None).is_err());
        assert!(!output.exists());
        write(work.path(), "outside.ts", "export const value = 1;");
        std::os::unix::fs::symlink(work.path().join("outside.ts"), project.join("outside.ts")).unwrap();
        write(
            &project,
            "zero.config.ts",
            "import { defineConfig } from 'zero'; import { value } from './outside'; export default defineConfig({ name: String(value) });",
        );
        assert!(zero::bundle::sources(&project, &work.path().join("escape")).is_err());
    }
}
