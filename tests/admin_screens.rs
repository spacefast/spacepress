//! `adminScreen()` (docs/admin-screens.md): a screen declared in TypeScript compiles to the
//! declaration `tp_admin_register_screen()` takes, in schema.php, with action references as
//! the Abilities the runtime registers for them. Each mistake is refused at its source location
//! with a fix.

#![cfg(feature = "cli")]

use std::path::Path;
use std::process::{Command, Output};

fn first() -> Command {
    Command::new(env!("CARGO_BIN_EXE_typedpress"))
}

/// Two actions every case uses: a readonly list and a write that takes an id.
const ACTIONS: &str = r#"import { action, adminScreen, item, defineConfig, integer, text } from "typedpress";

export const listPending = action({
  input: { limit: integer().optional() },
  readonly: true,
  access: "editor",
  handler: () => ({ rows: [{ id: 1, total: 3, shipped: false }] }),
});

export const markShipped = action({
  input: { id: integer(), note: text().optional() },
  access: "editor",
  handler: ({ id }) => ({ id }),
});

export const purge = action({
  input: { id: integer() },
  destructive: true,
  idempotent: true,
  handler: ({ id }) => id,
});
"#;

fn project(screens: &str) -> tempfile::TempDir {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        format!("{ACTIONS}\n{screens}\nexport default defineConfig({{ name: \"shop\" }});\n"),
    )
    .unwrap();
    tmp
}

fn check(dir: &Path) -> Output {
    first().arg("check").arg(dir).output().expect("run first")
}

/// The screens text starts after ACTIONS and one blank line.
fn line(offset: usize) -> usize {
    ACTIONS.lines().count() + 2 + offset
}

const VIEW: &str = r#"view: {
    action: listPending,
    items: "rows",
    fields: { id: { label: "Order" }, total: { label: "Total", type: "number" }, shipped: { label: "Shipped", type: "boolean" } },
    layout: { type: "table", titleField: "id", fields: ["total", "shipped"] },
  },"#;

#[test]
fn a_screen_compiles_into_schema_php_with_abilities_for_its_actions() {
    let tmp = project(&format!(
        r#"export const pendingOrders = adminScreen({{
  title: "Pending orders",
  description: "Orders waiting to ship.",
  access: "editor",
  {VIEW}
  actions: [
    {{ id: "ship", label: "Mark shipped", action: markShipped, input: {{ id: item("id") }} }},
    {{ id: "purge", label: "Purge", action: purge, input: {{ id: item("id") }}, confirm: "Purge it?" }},
  ],
  menu: {{ icon: "dashicons-cart" }},
  classic: {{ parent: "tools.php" }},
  data: ["Shipping runs at 4pm."],
}});

export const orderForm = adminScreen({{
  title: "Order",
  capability: "edit_others_posts",
  form: {{
    action: listPending,
    input: {{ limit: 1 }},
    item: "rows.0",
    fields: {{ id: {{}}, note: {{ label: "Note" }} }},
    layout: {{ fields: ["note"] }},
    submit: {{ id: "save", label: "Save", action: markShipped, input: {{ id: item("id"), note: item("note") }} }},
  }},
  menu: false,
  classic: false,
}});
"#
    ));
    let out = first().arg("build").arg(tmp.path()).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let schema = Command::new("php")
        .args(["-r", "echo json_encode(require $argv[1]);"])
        .arg(
            tmp.path()
                .join("tp/dist/wp-content/plugins/typedpress-app-shop/tp/app/schema.php"),
        )
        .output()
        .unwrap();
    assert!(schema.status.success(), "{}", String::from_utf8_lossy(&schema.stderr));
    let schema: serde_json::Value = serde_json::from_slice(&schema.stdout).unwrap();
    assert_eq!(
        schema["screens"]["pending-orders"],
        serde_json::json!({
            "title": "Pending orders",
            "description": "Orders waiting to ship.",
            "capability": "edit_others_posts",
            "classic": { "parent": "tools.php" },
            "menu": { "icon": "dashicons-cart" },
            "view": {
                "ability": "shop/list-pending",
                "items": "rows",
                "fields": [
                    { "id": "id", "label": "Order" },
                    { "id": "total", "label": "Total", "type": "number" },
                    { "id": "shipped", "label": "Shipped", "type": "boolean" },
                ],
                "layout": { "type": "table", "titleField": "id", "fields": ["total", "shipped"] },
            },
            "actions": [
                { "id": "ship", "label": "Mark shipped", "ability": "shop/mark-shipped", "input": { "id": "{item.id}" } },
                // `destructive` comes from the action when the screen doesn't say.
                { "id": "purge", "label": "Purge", "ability": "shop/purge", "input": { "id": "{item.id}" }, "destructive": true, "confirm": "Purge it?" },
            ],
            "data": ["Shipping runs at 4pm."],
        })
    );
    let form = &schema["screens"]["order-form"];
    assert_eq!(form["capability"], "edit_others_posts");
    assert_eq!(
        (form["menu"].clone(), form["classic"].clone()),
        (false.into(), false.into())
    );
    assert_eq!(form["form"]["ability"], "shop/list-pending");
    assert_eq!(form["form"]["item"], "rows.0");
    assert_eq!(
        form["form"]["submit"],
        serde_json::json!({ "id": "save", "label": "Save", "ability": "shop/mark-shipped", "input": { "id": "{item.id}", "note": "{item.note}" } })
    );
}

#[test]
fn an_app_without_screens_has_no_screens_key() {
    let tmp = project("");
    let out = first().arg("build").arg(tmp.path()).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let php = std::fs::read_to_string(
        tmp.path()
            .join("tp/dist/wp-content/plugins/typedpress-app-shop/tp/app/schema.php"),
    )
    .unwrap();
    assert!(!php.contains("'screens'"), "{php}");
}

/// Each refusal: the screens source, the message, the 1-based line offset inside it, and the fix.
#[test]
fn screen_mistakes_are_refused_where_they_are_written_with_a_fix() {
    let cases: &[(&str, &str, usize, &str)] = &[
        (
            "export const s = adminScreen({ title: \"S\", view: { action: markShipped, fields: { id: {} } } });",
            "`view.action` runs `markShipped`, which isn't readonly",
            0,
            "add `readonly: true` to `markShipped`",
        ),
        (
            "export const s = adminScreen({ title: \"S\", view: { action: \"listPending\", fields: { id: {} } } });",
            "`view.action` names an action, but it is \"listPending\"",
            0,
            "pass the action itself, not its name: `action: listPending`",
        ),
        (
            "const local = (x: number) => x;\nexport const s = adminScreen({\n  title: \"S\",\n  view: { action: listPending, fields: { id: {} } },\n  actions: [{ id: \"x\", label: \"X\", action: local }],\n});",
            "the screen action `x` names an action, but it is a function",
            4,
            "pass an exported action",
        ),
        (
            "export const s = adminScreen({\n  title: \"S\",\n  view: { action: listPending, fields: { id: {}, total: {} }, layout: { fields: [\"totl\"] } },\n});",
            "`view.layout.fields` names `totl`, which isn't in `view.fields`",
            2,
            "did you mean `\"total\"`?",
        ),
        (
            "export const s = adminScreen({\n  title: \"S\",\n  view: { action: listPending, fields: { id: {} }, layout: { titleField: \"name\" } },\n});",
            "`view.layout.titleField` names `name`, which isn't in `view.fields`",
            2,
            "declare `name` in `fields`",
        ),
        (
            "export const s = adminScreen({\n  title: \"S\",\n  view: { action: listPending, fields: { id: {} } },\n  actions: [{ id: \"ship\", label: \"Ship\", action: markShipped, input: { id: item(\"id\"), nte: \"x\" } }],\n});",
            "the action `markShipped` has no input `nte`",
            3,
            "did you mean `note`?",
        ),
        (
            "export const s = adminScreen({\n  title: \"S\",\n  view: { action: listPending, fields: { id: {} } },\n  actions: [{ id: \"ship\", label: \"Ship\", action: markShipped, input: { note: \"x\" } }],\n});",
            "the action `markShipped` needs the input `id`",
            3,
            "add it: `input: { id: item(\"id\") }`",
        ),
        (
            "export const s = adminScreen({\n  title: \"S\",\n  view: { action: listPending, fields: { id: {} } },\n  actions: [{ id: \"ship\", label: \"Ship\", action: markShipped, input: { id: item(\"orderId\") } }],\n});",
            "`item(\"orderId\")` names `orderId`, which isn't a field of this screen",
            3,
            "declare `orderId` in the screen's `fields`",
        ),
        (
            "export const s = adminScreen({\n  title: \"S\",\n  view: { action: listPending, input: { limit: item(\"id\") }, fields: { id: {} } },\n});",
            "`item(\"id\")` has no item here",
            2,
            "give a fixed value",
        ),
        (
            "export const s = adminScreen({\n  title: \"S\",\n  view: { action: listPending, fields: { total: { type: \"numbr\" } } },\n});",
            "field `total` has the type `numbr`, which DataViews doesn't show",
            2,
            "did you mean `\"number\"`?",
        ),
        (
            "export const s = adminScreen({ title: \"S\" });",
            "adminScreen() needs a `view` (a list) or a `form`",
            0,
            "add `view: { action: listOrders",
        ),
        (
            "export const s = adminScreen({\n  title: \"S\",\n  view: { action: listPending, fields: { id: {} } },\n  form: { action: listPending, fields: { id: {} } },\n});",
            "a screen has a `view` or a `form`, not both",
            3,
            "make two screens",
        ),
        (
            "export const s = adminScreen({\n  title: \"S\",\n  acess: \"editor\",\n  view: { action: listPending, fields: { id: {} } },\n});",
            "adminScreen() has no option `acess`",
            2,
            "did you mean `access`?",
        ),
        (
            "export const s = adminScreen({\n  title: \"S\",\n  access: \"editr\",\n  view: { action: listPending, fields: { id: {} } },\n});",
            "`access: \"editr\"` isn't a role an admin screen takes",
            2,
            "did you mean `\"editor\"`?",
        ),
        (
            "export const tableComments = adminScreen({ title: \"S\", view: { action: listPending, fields: { id: {} } } });",
            "the screen id `table-comments` is one TypedPress registers itself",
            0,
            "export the screen under another name",
        ),
        (
            "const s = adminScreen({ title: \"S\", view: { action: listPending, fields: { id: {} } } });",
            "`s` is an admin screen but isn't exported, so it has no name",
            0,
            "export const s = adminScreen({ ... })",
        ),
    ];
    for (source, message, offset, help) in cases {
        let tmp = project(source);
        let out = check(tmp.path());
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{source}\nshould fail, got:\n{stderr}");
        assert!(stderr.contains(message), "expected {message:?} in:\n{stderr}");
        assert!(stderr.contains(help), "expected the fix {help:?} in:\n{stderr}");
        let at = format!("--> typedpress.config.ts:{}:", line(*offset));
        assert!(stderr.contains(&at), "expected location {at} in:\n{stderr}");
    }
}

#[test]
fn define_config_takes_no_screens_option() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("typedpress.config.ts"),
        format!(
            "{ACTIONS}\nexport const s = adminScreen({{ title: \"S\", view: {{ action: listPending, fields: {{ id: {{}} }} }} }});\nexport default defineConfig({{ name: \"shop\", screens: {{ s }} }});\n"
        ),
    )
    .unwrap();
    let out = check(tmp.path());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{stderr}");
    assert!(stderr.contains("defineConfig() has no option `screens`"), "{stderr}");
    assert!(
        stderr.contains(&format!("--> typedpress.config.ts:{}:", line(1))),
        "{stderr}"
    );
}

#[test]
fn an_agents_false_action_has_no_ability_for_a_screen() {
    let tmp = project(
        "export const hidden = action({ input: {}, readonly: true, agents: false, handler: () => [] });\nexport const s = adminScreen({ title: \"S\", view: { action: hidden, fields: { id: {} } } });",
    );
    let out = check(tmp.path());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{stderr}");
    assert!(stderr.contains("the action `hidden` is `agents: false`"), "{stderr}");
    assert!(
        stderr.contains(&format!("--> typedpress.config.ts:{}:", line(1))),
        "{stderr}"
    );
}
