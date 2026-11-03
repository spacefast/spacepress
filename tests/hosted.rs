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
        "import { defineConfig, action } from 'zero'; import { message } from './src/message'; import { suffix } from 'shared'; export default defineConfig({ actions: { version: action({ access: 'anyone', handler() { return message + suffix; } }) } });",
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
    write(&project, "unrelated.ts", "this is not an input");
    let first = work.path().join("first");
    let sources = zero::hosted::sources(&project, &first).unwrap();
    assert!(sources.files.contains("node_modules/shared/index.js"));
    assert!(!sources.files.contains("unrelated.ts"));
    write(&project, "src/message.ts", "export const message = 'v2';");
    let second = work.path().join("second");
    zero::hosted::sources(&project, &second).unwrap();
    fs::remove_dir_all(&project).unwrap();
    let compiled_first = work.path().join("compiled-first");
    let compiled_second = work.path().join("compiled-second");
    let manifest = zero::hosted::compile(&first, &compiled_first, None).unwrap();
    assert_eq!(manifest["compiler"], zero::hosted::VERSION);
    let path = "plugins/zero-app-app/zero/app/functions.php";
    let before = fs::read(compiled_first.join(path)).unwrap();
    zero::hosted::compile(&second, &compiled_second, Some(&compiled_first)).unwrap();
    assert_ne!(before, fs::read(compiled_second.join(path)).unwrap());
    assert_eq!(before, fs::read(compiled_first.join(path)).unwrap());
    assert!(zero::hosted::compile(&second, &compiled_first, None).is_err());
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
    assert!(zero::hosted::sources(&project, &work.path().join("upload")).is_err());
    fs::remove_dir_all(project.join("public")).unwrap();
    #[cfg(unix)]
    {
        write(work.path(), "outside.ts", "export const value = 1;");
        std::os::unix::fs::symlink(work.path().join("outside.ts"), project.join("outside.ts")).unwrap();
        write(
            &project,
            "zero.config.ts",
            "import { defineConfig } from 'zero'; import { value } from './outside'; export default defineConfig({ name: String(value) });",
        );
        assert!(zero::hosted::sources(&project, &work.path().join("escape")).is_err());
    }
}
