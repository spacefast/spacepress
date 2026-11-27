//! Verifies SpacePress config, built-in module specifiers and their compatibility aliases,
//! `spacepress.source-bundle.v1` capture/compile, and `ctx.connectors.call()` compilation.

#[cfg(feature = "host")]
#[test]
fn spacepress_config_and_connectors_compile_to_store() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    std::fs::create_dir_all(project.join("sp")).unwrap();

    std::fs::write(
        project.join("spacepress.config.ts"),
        r#"
import { defineConfig, collection, f, mutation } from "spacepress";

export const posts = collection({
    title: f.text(),
});

export const notify = mutation(
    { access: "anyone" },
    async ({ connectors }, { message }: { message: string }) => {
        return await connectors.call("slack", "post_message", { text: message });
    },
);

export default defineConfig({ name: "my-spacepress-app" });
"#,
    )
    .unwrap();

    let captured_dir = temp.path().join("captured");
    let manifest = spacepress::host::sources(&project, &captured_dir).unwrap();
    assert_eq!(manifest.format, "spacepress.source-bundle.v1");
    assert_eq!(manifest.name, "my-spacepress-app");
    assert!(captured_dir.join("app.spacepress.json").is_file());
    assert!(captured_dir.join("vendor.spacepress.json").is_file());

    let store_dir = temp.path().join("store");
    let stored = spacepress::host::compile_to_store(&captured_dir, &store_dir, &captured_dir, None).unwrap();
    assert_eq!(stored.manifest.name, "my-spacepress-app");

    let app_plugin = store_dir
        .join("app")
        .join(&stored.manifest.app)
        .join("plugins/spacepress-app-my-spacepress-app/sp/app/functions.php");
    let php = std::fs::read_to_string(&app_plugin).unwrap();
    assert!(
        php.contains("\\SpacePress\\Connectors::call("),
        "expected compiled connectors call in functions.php:\n{php}"
    );

    let runtime_connectors = store_dir
        .join("runtime")
        .join(&stored.manifest.runtime)
        .join("spacepress-runtime/sp/Connectors.php");
    assert!(
        runtime_connectors.is_file(),
        "expected embedded Connectors.php at {}",
        runtime_connectors.display()
    );
}

#[cfg(feature = "host")]
#[test]
fn spacefast_module_aliases_compile_from_captured_sources() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    std::fs::create_dir_all(project.join("sp")).unwrap();

    std::fs::write(
        project.join("spacepress.config.ts"),
        r#"
import { defineConfig, collection, f } from "spacefast/app";

export const notes = collection({
    title: f.text(),
    body: f.text(),
});

export default defineConfig({ name: "notes-app" });
"#,
    )
    .unwrap();

    std::fs::write(
        project.join("sp/actions.ts"),
        r#"
import { query } from "@spacefast/spacepress";

export const countNotes = query(
    { access: "anyone" },
    async ({ db }) => {
        const rows = await db.notes.list({ limit: 5 });
        return { count: rows.length };
    },
);
"#,
    )
    .unwrap();

    let captured_dir = temp.path().join("captured");
    let manifest = spacepress::host::sources(&project, &captured_dir).unwrap();
    assert_eq!(manifest.format, "spacepress.source-bundle.v1");

    let store_dir = temp.path().join("store");
    let stored = spacepress::host::compile_to_store(&captured_dir, &store_dir, &captured_dir, None).unwrap();
    assert_eq!(stored.manifest.name, "notes-app");
}

/// Compiles one `spacepress.config.ts` through the host path: the app plugin's functions.php, or the
/// build's refusal as `message (help)`.
#[cfg(feature = "host")]
fn compile_config(config: &str) -> Result<String, String> {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    std::fs::create_dir_all(project.join("sp")).unwrap();
    std::fs::write(project.join("spacepress.config.ts"), config).unwrap();
    let captured = temp.path().join("captured");
    let manifest = spacepress::host::sources(&project, &captured).map_err(|d| d.message)?;
    let store = temp.path().join("store");
    let stored = spacepress::host::compile_to_store(&captured, &store, &captured, None)
        .map_err(|d| format!("{} ({})", d.message, d.help.unwrap_or_default()))?;
    let functions = store
        .join("app")
        .join(&stored.manifest.app)
        .join(format!("plugins/spacepress-app-{}/sp/app/functions.php", manifest.name));
    Ok(std::fs::read_to_string(functions).unwrap())
}

#[cfg(feature = "host")]
#[test]
fn connectors_enqueue_compiles_to_the_queued_runtime_call() {
    let php = compile_config(
        r#"
import { defineConfig, collection, f, mutation } from "spacepress";

export const orders = collection({ title: f.text() });

export const ship = mutation({ access: "anyone" }, async ({ connectors }, { order }: { order: string }) => {
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
        "\\SpacePress\\Connectors::enqueue('fulfilment','create_shipment',(new\\SpacePress\\JsObject(array('order'=>$order))),(new\\SpacePress\\JsObject(array('key'=>",
        "'delay'=>30",
        "\\SpacePress\\Connectors::enqueue('fulfilment','ping',null,null)",
        "\\SpacePress\\Connectors::call('crm','find',(new\\SpacePress\\JsObject(array('q'=>$order))))",
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
import {{ defineConfig, collection, f, mutation, query }} from "spacepress";
export const orders = collection({{ title: f.text() }});
export const run = {kind}({{ access: "anyone" }}, async (ctx, {{ order }}: {{ order: string }}) => {{
    {handler}
    return {{ ok: true }};
}});
export default defineConfig({{ name: "outbox-app" }});
"#
        )
    };
    for (handler, kind, expected) in [
        (
            r#"await ctx.connectors.enqueue("fulfilment", "create_shipment", { order });"#,
            "query",
            "connectors",
        ),
        (
            r#"await ctx.connectors.enqueue("fulfilment", "create_shipment", { order }, { retries: 3 });"#,
            "mutation",
            "connectors.enqueue() options are",
        ),
        (
            r#"await ctx.connectors.enqueue("fulfilment", "create_shipment", { order }, {}, 1);"#,
            "mutation",
            "connectors.enqueue() takes a connector role, a tool name, optional args and optional options",
        ),
        (
            r#"await ctx.connectors.call("crm", "find", { q: order }, { key: "x" });"#,
            "mutation",
            "connectors.call() takes a connector role, a tool name, and optional args",
        ),
        (
            r#"await ctx.connectors.enqueue(42, "create_shipment");"#,
            "mutation",
            "connectors.enqueue() role must be a string",
        ),
        (
            r#"await ctx.connectors.publish("fulfilment", "create_shipment");"#,
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
