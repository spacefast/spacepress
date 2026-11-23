//! `adminWidget()`, `adminDashboard()`, and kind/global `ui` options compile cleanly into
//! `schema.php` and refuse mistakes with helpful diagnostics.

#![cfg(feature = "cli")]

use std::path::Path;
use std::process::{Command, Output};

fn sp() -> Command {
    Command::new(env!("CARGO_BIN_EXE_spacepress"))
}

fn check(dir: &Path) -> Output {
    sp().arg("check").arg(dir).output().expect("run spacepress check")
}

fn build(dir: &Path) -> Output {
    sp().arg("build").arg(dir).output().expect("run spacepress build")
}

#[test]
fn widgets_dashboards_and_kind_ui_compile_into_schema_php() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("spacepress.config.ts"),
        r#"import {
  adminDashboard,
  adminWidget,
  collection,
  defineConfig,
  global,
  integer,
  query,
  richText,
  text,
} from "spacepress";

export const docs = collection(
  {
    title: text(),
    body: richText().optional(),
    summary: text().optional(),
  },
  {
    label: "Docs",
    ui: {
      icon: "book",
      singularLabel: "Doc",
      description: "Reference documentation",
      defaultColumns: ["summary"],
    },
  },
);

export const siteCopy = global(
  {
    tagline: text().default("Hello"),
  },
  {
    label: "Site Copy",
    ui: {
      icon: "globe",
      description: "Shared hero copy",
    },
  },
);

export const salesMetrics = query(
  { access: "editor" },
  () => ({ orders: 12, revenue: 450 }),
);

export const salesPulse = adminWidget({
  title: "Sales pulse",
  description: "Today's orders and revenue.",
  access: "editor",
  action: salesMetrics,
  metrics: [
    { label: "Orders", path: "orders", format: "number" },
    { label: "Revenue", path: "revenue", format: "currency" },
  ],
  width: 2,
  height: 2,
  link: { label: "View orders", to: "/collections/docs" },
});

export const opsDashboard = adminDashboard({
  title: "Operations",
  description: "Live editorial & sales overview",
  access: "editor",
  widgets: [
    "sp/content-overview",
    { widget: salesPulse, width: 2, height: 2 },
  ],
});

export default defineConfig({ name: "site" });
"#,
    )
    .unwrap();

    let out = build(tmp.path());
    assert!(
        out.status.success(),
        "build failed:\n{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let schema = std::fs::read_to_string(
        tmp.path()
            .join("sp/dist/wp-content/plugins/spacepress-app-site/sp/app/schema.php"),
    )
    .expect("schema.php");
    assert!(schema.contains("'singularLabel' => 'Doc'"), "{schema}");
    assert!(schema.contains("'defaultColumns' => ['summary']"), "{schema}");
    assert!(schema.contains("'widgets' => ["), "{schema}");
    assert!(schema.contains("'sales-pulse' =>"), "{schema}");
    assert!(schema.contains("'ability' => 'site/sales-metrics'"), "{schema}");
    assert!(schema.contains("'dashboards' => ["), "{schema}");
    assert!(schema.contains("'ops-dashboard' =>"), "{schema}");
    assert!(schema.contains("'type' => 'sp-widget/sales-pulse'"), "{schema}");
    assert!(schema.contains("'type' => 'sp/content-overview'"), "{schema}");
}

#[test]
fn rejects_non_readonly_widget_action_and_duplicate_home_dashboards() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("spacepress.config.ts"),
        r#"import { mutation, adminWidget, defineConfig } from "spacepress";

export const mutate = mutation(
  { access: "editor" },
  () => ({ ok: true }),
);

export const bad = adminWidget({
  title: "Bad",
  action: mutate,
});

export default defineConfig({ name: "site" });
"#,
    )
    .unwrap();
    let out = check(tmp.path());
    assert!(!out.status.success());
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("isn't readonly"), "{err}");

    std::fs::write(
        tmp.path().join("spacepress.config.ts"),
        r#"import { adminDashboard, defineConfig } from "spacepress";

export const one = adminDashboard({
  title: "One",
  home: true,
  widgets: ["sp/content-overview"],
});

export const two = adminDashboard({
  title: "Two",
  home: true,
  widgets: ["sp/recent-activity"],
});

export default defineConfig({ name: "site" });
"#,
    )
    .unwrap();
    let out2 = check(tmp.path());
    assert!(!out2.status.success());
    let err2 = String::from_utf8_lossy(&out2.stderr);
    assert!(err2.contains("home: true"), "{err2}");
}
