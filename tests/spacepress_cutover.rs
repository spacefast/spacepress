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

/// Compiles one `spacepress.config.ts` through the host path: the app plugin's functions.php, or the
/// build's refusal as `message (help)`.
#[cfg(feature = "host")]
fn compile_config(config: &str) -> Result<String, String> {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    std::fs::create_dir_all(project.join("tp")).unwrap();
    std::fs::write(project.join("spacepress.config.ts"), config).unwrap();
    let captured = temp.path().join("captured");
    let manifest = typedpress::host::sources(&project, &captured).map_err(|d| d.message)?;
    let store = temp.path().join("store");
    let stored = typedpress::host::compile_to_store(&captured, &store, &captured, None)
        .map_err(|d| format!("{} ({})", d.message, d.help.unwrap_or_default()))?;
    let functions = store
        .join("app")
        .join(&stored.manifest.app)
        .join(format!("plugins/typedpress-app-{}/tp/app/functions.php", manifest.name));
    Ok(std::fs::read_to_string(functions).unwrap())
}

#[cfg(feature = "host")]
#[test]
fn connectors_enqueue_compiles_to_the_queued_runtime_call() {
    let php = compile_config(
        r#"
import { defineConfig, collection, text, mutation, connectors } from "spacepress";

export const orders = collection({ title: text() });

export const ship = mutation({ access: "anyone" }, async ({ order }: { order: string }) => {
    const queued = await connectors.enqueue("fulfilment", "create_shipment", { order }, { key: `ship-${order}`, delay: 30 });
    const bare = await connectors.enqueue("fulfilment", "ping");
    const now = await connectors.call("crm", "find", { q: order });
    return { id: queued.id, bare: bare.id, now };
});

export default defineConfig({ name: "outbox-app" });
"#,
    )
    .unwrap();
    // The PHP formatter pads calls; compare without whitespace.
    let flat: String = php.chars().filter(|c| !c.is_whitespace()).collect();
    for call in [
        "\\TypedPress\\Connectors::enqueue('fulfilment','create_shipment',(new\\TypedPress\\JsObject(array('order'=>$order))),(new\\TypedPress\\JsObject(array('key'=>",
        "'delay'=>30",
        "\\TypedPress\\Connectors::enqueue('fulfilment','ping',null,null)",
        "\\TypedPress\\Connectors::call('crm','find',(new\\TypedPress\\JsObject(array('q'=>$order))))",
    ] {
        assert!(flat.contains(call), "expected `{call}` in functions.php:\n{php}");
    }
}

#[cfg(feature = "host")]
#[test]
fn connectors_enqueue_refuses_what_it_cannot_queue() {
    let app = |handler: &str, kind: &str| {
        format!(
            r#"
import {{ defineConfig, collection, text, mutation, query, connectors }} from "spacepress";
export const orders = collection({{ title: text() }});
export const run = {kind}({{ access: "anyone" }}, async ({{ order }}: {{ order: string }}) => {{
    {handler}
    return {{ ok: true }};
}});
export default defineConfig({{ name: "outbox-app" }});
"#
        )
    };
    for (handler, kind, expected) in [
        (
            r#"await connectors.enqueue("fulfilment", "create_shipment", { order });"#,
            "query",
            "queues a connector call",
        ),
        (
            r#"await connectors.enqueue("fulfilment", "create_shipment", { order }, { retries: 3 });"#,
            "mutation",
            "connectors.enqueue() options are",
        ),
        (
            r#"await connectors.enqueue("fulfilment", "create_shipment", { order }, {}, 1);"#,
            "mutation",
            "connectors.enqueue() takes a connector role, a tool name, optional args and optional options",
        ),
        (
            r#"await connectors.call("crm", "find", { q: order }, { key: "x" });"#,
            "mutation",
            "connectors.call() takes a connector role, a tool name, and optional args",
        ),
        (
            r#"await connectors.enqueue(42, "create_shipment");"#,
            "mutation",
            "connectors.enqueue() role must be a string",
        ),
        (
            r#"await connectors.publish("fulfilment", "create_shipment");"#,
            "mutation",
            "`connectors` has no function `publish`",
        ),
    ] {
        let refused = compile_config(&app(handler, kind)).expect_err(handler);
        assert!(
            refused.contains(expected),
            "{handler}: expected `{expected}`, got `{refused}`"
        );
    }
}
