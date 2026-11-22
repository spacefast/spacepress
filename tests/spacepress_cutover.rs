//! Verifies SpacePress config, module specifiers (`spacepress`, `spacefast/app`, `spacepress:db`),
//! `spacepress.source-bundle.v1` capture/compile, and `connectors.call()` compilation.

#[cfg(feature = "host")]
#[test]
fn spacepress_config_and_connectors_compile_to_store() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    std::fs::create_dir_all(project.join("tp")).unwrap();

    std::fs::write(
        project.join("spacepress.config.ts"),
        r#"
import { defineConfig, collection, text, mutation, connectors } from "spacepress";

export const posts = collection({
    title: text(),
});

export const notify = mutation(
    { access: "anyone" },
    async ({ message }: { message: string }) => {
        return await connectors.call("slack", "post_message", { text: message });
    },
);

export default defineConfig({ name: "my-spacepress-app" });
"#,
    )
    .unwrap();

    let captured_dir = temp.path().join("captured");
    let manifest = typedpress::host::sources(&project, &captured_dir).unwrap();
    assert_eq!(manifest.format, "spacepress.source-bundle.v1");
    assert_eq!(manifest.name, "my-spacepress-app");
    assert!(captured_dir.join("app.spacepress.json").is_file());
    assert!(captured_dir.join("vendor.spacepress.json").is_file());

    let store_dir = temp.path().join("store");
    let stored = typedpress::host::compile_to_store(&captured_dir, &store_dir, &captured_dir, None).unwrap();
    assert_eq!(stored.manifest.name, "my-spacepress-app");

    let app_plugin = store_dir
        .join("app")
        .join(&stored.manifest.app)
        .join("plugins/typedpress-app-my-spacepress-app/tp/app/functions.php");
    let php = std::fs::read_to_string(&app_plugin).unwrap();
    assert!(
        php.contains("\\TypedPress\\Connectors::call("),
        "expected compiled connectors call in functions.php:\n{php}"
    );

    let runtime_connectors = store_dir
        .join("runtime")
        .join(&stored.manifest.runtime)
        .join("typedpress-runtime/tp/Connectors.php");
    assert!(
        runtime_connectors.is_file(),
        "expected embedded Connectors.php at {}",
        runtime_connectors.display()
    );
}

#[cfg(feature = "host")]
#[test]
fn spacefast_app_module_specifier_and_spacepress_db_compile() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    std::fs::create_dir_all(project.join("tp")).unwrap();

    std::fs::write(
        project.join("spacepress.config.ts"),
        r#"
import { defineConfig, collection, text } from "spacefast/app";

export const notes = collection({
    title: text(),
    body: text(),
});

export default defineConfig({ name: "notes-app" });
"#,
    )
    .unwrap();

    std::fs::write(
        project.join("tp/actions.ts"),
        r#"
import { query, db } from "spacefast/app";
import { notes } from "spacepress:db";

export const countNotes = query(
    { access: "anyone" },
    async () => {
        const rows = await db.query.notes.findMany();
        return { count: rows.length };
    },
);
"#,
    )
    .unwrap();

    let captured_dir = temp.path().join("captured");
    let manifest = typedpress::host::sources(&project, &captured_dir).unwrap();
    assert_eq!(manifest.format, "spacepress.source-bundle.v1");

    let store_dir = temp.path().join("store");
    let stored = typedpress::host::compile_to_store(&captured_dir, &store_dir, &captured_dir, None).unwrap();
    assert_eq!(stored.manifest.name, "notes-app");
}
