use spacepress::{loader, pipeline};
use std::fs;
use std::path::Path;
use std::process::Command;

fn write(dir: &Path, rel: &str, content: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

fn compile_err(dir: &Path) -> String {
    let entry = dir.join("spacepress.config.ts");
    match loader::load_all(&entry) {
        Err(diags) => diags
            .iter()
            .map(|d| format!("{} {}", d.message, d.help.as_deref().unwrap_or("")))
            .collect::<Vec<_>>()
            .join("\n"),
        Ok(program) => {
            let err = pipeline::build(dir, &program, || Ok(pipeline::Previous::none()), |_| None)
                .err()
                .expect("expected compilation to fail");
            format!("{} {}", err.message, err.help.as_deref().unwrap_or(""))
        }
    }
}

fn compile_ok(dir: &Path) -> pipeline::Built {
    let entry = dir.join("spacepress.config.ts");
    let program = loader::load(&entry).expect("program should load");
    pipeline::build(dir, &program, || Ok(pipeline::Previous::none()), |_| None).expect("program should compile")
}

#[test]
fn canonical_import_split_compiles_with_react_and_client_react_hooks() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write(
        root,
        "spacepress.config.ts",
        r#"import { defineConfig } from "spacepress";
export default defineConfig({ name: "split-demo" });
"#,
    );
    write(
        root,
        "sp/schema.ts",
        r#"import { collection, mutation, text } from "spacepress";
import { db, HttpError } from "spacepress/server";

export const notes = collection({
  title: text().min(1),
}, { access: { read: "anyone", create: "anyone" } });

export const addNote = mutation({ access: "anyone" }, async ({ title }: { title: string }) => {
  if (!title.trim()) throw new HttpError(400, "empty", "Title required", "/title");
  const [row] = await db.insert(notes).values({ title }).returning();
  if (!row) throw new HttpError(500, "insert_failed", "Failed to save note");
  return { id: row.id, title: row.title };
});
"#,
    );
    write(
        root,
        "sp/components/Counter.tsx",
        r#""use client";
import { useEffect, useRef, useState } from "react";
import { sharedState, useEvent, useLive, useMount } from "@spacepress/client/react";
import { addNote } from "../schema";

export const shared = sharedState({ clicks: 0 });

export function Counter({ start }: { start: number }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [count, setCount] = useState(start);
  const [ready, setReady] = useState(false);
  const notes = useLive<{ id: number; title: string }>("notes", { limit: 10 });
  useMount(() => { setReady(true); });
  useEffect(() => {
    if (shared.clicks > 0) buttonRef.current?.focus();
  }, [shared.clicks]);
  useEvent("keydown", (event) => {
    if (event.key === "Escape") setCount(0);
  });
  return (
    <div>
      <button ref={buttonRef} type="button" disabled={!ready} onClick={async () => {
        setCount(count + 1);
        shared.clicks += 1;
        await addNote({ title: "Note" });
      }}>
        {count} ({notes.data?.length ?? 0})
      </button>
    </div>
  );
}
"#,
    );
    write(
        root,
        "sp/app/page.tsx",
        r#"import { notes } from "spacepress/server/db";
import { Link, useFormState } from "spacepress/server/app";
import { esc_html } from "spacepress/server/wp";
import { addNote } from "../schema";
import { Counter } from "../components/Counter";

export default async function Home() {
  const rows = await notes.list({ limit: 5 });
  const state = useFormState(addNote);
  return (
    <main>
      <h1>{esc_html("Hello")} ({rows.length})</h1>
      <Link href="/">Refresh</Link>
      <form action={addNote}>
        <input name="title" defaultValue={state.values.title ?? ""} />
        <button type="submit">Save</button>
      </form>
      <Counter start={0} />
    </main>
  );
}
"#,
    );
    let built = compile_ok(root);
    assert!(built.schema.islands.contains_key("split-demo/Counter"));
    let routes = built.routes_ts.as_deref().unwrap_or("");
    assert!(
        routes.contains("declare module \"spacepress/server/app\""),
        "routes.d.ts should augment spacepress/server/app, got:\n{routes}"
    );
    assert!(
        built.gen_ts.contains("declare module \"spacepress/server/wp\""),
        "db.d.ts should augment spacepress/server/wp, got:\n{}",
        built.gen_ts
    );
}

#[test]
fn use_client_refuses_direct_and_transitive_server_imports() {
    for server_spec in [
        "spacepress/server",
        "spacepress/server/db",
        "spacepress/server/app",
        "spacepress/server/content",
        "spacepress/server/wp",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(
            root,
            "spacepress.config.ts",
            "import { defineConfig } from \"spacepress\";\nexport default defineConfig({ name: \"guard-test\" });\n",
        );
        write(
            root,
            "sp/components/Bad.tsx",
            &format!(
                "\"use client\";\nimport {{ useState }} from \"react\";\nimport {{ x }} from \"{server_spec}\";\nexport function Bad() {{ const [n] = useState(0); return <div>{{n}}{{String(x)}}</div>; }}\n"
            ),
        );
        let msg = compile_err(root);
        assert!(
            msg.contains("server APIs run only on the server") && msg.contains("@spacepress/client"),
            "expected server-only refusal for {server_spec}, got:\n{msg}"
        );
    }

    // Transitive server import through a non-action helper is also refused.
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write(
        root,
        "spacepress.config.ts",
        "import { defineConfig } from \"spacepress\";\nexport default defineConfig({ name: \"transitive-guard\" });\n",
    );
    write(
        root,
        "sp/lib/serverHelper.ts",
        "import { db } from \"spacepress/server\";\nexport function helper() { return Boolean(db); }\n",
    );
    write(
        root,
        "sp/components/Sneaky.tsx",
        "\"use client\";\nimport { useState } from \"react\";\nimport { helper } from \"../lib/serverHelper\";\nexport function Sneaky() { const [n] = useState(0); return <button onClick={() => helper()}>{n}</button>; }\n",
    );
    let msg = compile_err(root);
    assert!(
        msg.contains("imports server-only module \"spacepress/server\"") && msg.contains("@spacepress/client"),
        "expected transitive server-only refusal, got:\n{msg}"
    );
}

#[test]
fn moved_and_legacy_specifiers_give_clear_diagnostics() {
    let cases = [
        ("import { db } from \"spacepress\";", "spacepress/server"),
        ("import { HttpError } from \"spacepress\";", "spacepress/server"),
        ("import { mail } from \"spacepress\";", "spacepress/server"),
        ("import { posts } from \"spacepress:db\";", "spacepress/server/db"),
        ("import { Link } from \"spacepress/app\";", "spacepress/server/app"),
        (
            "import { nav } from \"spacepress/content\";",
            "spacepress/server/content",
        ),
        ("import { esc_html } from \"php/wordpress\";", "spacepress/server/wp"),
        (
            "import { useState } from \"spacepress/client\";",
            "@spacepress/client/react",
        ),
    ];
    for (import_line, expected_target) in cases {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(
            root,
            "spacepress.config.ts",
            &format!(
                "import {{ defineConfig }} from \"spacepress\";\n{import_line}\nexport default defineConfig({{ name: \"diag-test\" }});\n"
            ),
        );
        let msg = compile_err(root);
        assert!(
            msg.contains(expected_target),
            "expected diagnostic for `{import_line}` to point to `{expected_target}`, got:\n{msg}"
        );
    }
}

#[test]
fn configurable_app_root_dir_works_end_to_end_beside_root_app() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();

    // Simulate an existing root app (e.g. Astro/Next/HTML) coexisting with SpacePress in `cms/`.
    write(root, "index.html", "<!doctype html><h1>Existing Root App</h1>\n");
    write(root, "src/outside.ts", "export const OUTSIDE = 1;\n");
    write(
        root,
        "spacepress.config.ts",
        r#"import { defineConfig } from "spacepress";
export default defineConfig({
  name: "coexist-demo",
  dir: "cms",
});
"#,
    );
    write(
        root,
        "cms/schema.ts",
        r#"import { collection, mutation, text } from "spacepress";
import { db } from "spacepress/server";

export const articles = collection({
  title: text().min(1),
}, { access: { read: "anyone", create: "anyone" } });

export const publishArticle = mutation({ access: "anyone" }, async ({ title }: { title: string }) => {
  const [row] = await db.insert(articles).values({ title }).returning();
  return row;
});
"#,
    );
    write(
        root,
        "cms/wp-hooks/excerpt_more.ts",
        r#"import type { Handler } from "spacepress/server/wp";
const more: Handler<"excerpt_more"> = () => "…";
export default more;
"#,
    );
    write(
        root,
        "cms/components/Badge.tsx",
        r#""use client";
import { useState } from "react";
export function Badge({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  return <button type="button" onClick={() => setOpen(!open)}>{open ? "Open" : label}</button>;
}
"#,
    );
    write(
        root,
        "cms/app/page.tsx",
        r#"import { articles } from "spacepress/server/db";
import { Badge } from "../components/Badge";

export default async function Home() {
  const rows = await articles.list({ limit: 5 });
  return <main><h1>{rows.length}</h1><Badge label="Info" /></main>;
}
"#,
    );

    // Build via the real CLI binary to verify `_generated/`, `dist/`, migrations, and no `sp/` leakage.
    let bin = env!("CARGO_BIN_EXE_spacepress");
    let out = Command::new(bin)
        .args(["build", root.to_str().unwrap()])
        .output()
        .expect("run spacepress build");
    assert!(
        out.status.success(),
        "spacepress build failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    // Everything lives under `cms/`, never `sp/`.
    assert!(
        !root.join("sp").exists(),
        "should not create default sp/ directory when dir is cms"
    );
    assert!(root.join("cms/_generated/db.d.ts").is_file());
    assert!(root.join("cms/_generated/routes.d.ts").is_file());
    assert!(root.join("cms/_generated/openapi.json").is_file());
    assert!(root.join("cms/_generated/client/index.ts").is_file());
    assert!(root.join("cms/_generated/migrations").is_dir());
    assert!(root.join("cms/dist/wp-content/spacepress-manifest.json").is_file());

    // `spacepress init` writes AGENTS.md describing `cms/`, not `sp/`.
    let init_out = Command::new(bin)
        .args(["init", root.to_str().unwrap()])
        .output()
        .expect("run spacepress init");
    assert!(
        init_out.status.success(),
        "spacepress init failed:\n{}",
        String::from_utf8_lossy(&init_out.stderr)
    );
    let agents = fs::read_to_string(root.join("AGENTS.md")).unwrap();
    assert!(agents.contains("`cms/`"), "AGENTS.md should document custom dir cms/");
    assert!(agents.contains("`cms/app/`"), "AGENTS.md should document cms/app/");
    assert!(
        agents.contains("`cms/_generated/`"),
        "AGENTS.md should document cms/_generated/"
    );

    // `spacepress check` succeeds cleanly on the custom dir project.
    let check_out = Command::new(bin)
        .args(["check", root.to_str().unwrap()])
        .output()
        .expect("run spacepress check");
    assert!(
        check_out.status.success(),
        "spacepress check failed:\n{}",
        String::from_utf8_lossy(&check_out.stderr)
    );

    // Import fence enforces the custom `cms/` boundary (refuses `../src/outside`).
    write(
        root,
        "cms/bad.ts",
        "import { OUTSIDE } from \"../src/outside\";\nexport const x = OUTSIDE;\n",
    );
    let fence_err = compile_err(root);
    assert!(
        fence_err.contains("outside cms/"),
        "expected import fence error naming cms/, got:\n{fence_err}"
    );
}

#[test]
fn invalid_dir_values_are_refused() {
    for bad_dir in [
        "\"\"",
        "\"/cms\"",
        "\"cms/\"",
        "\"../cms\"",
        "\".hidden\"",
        "\"node_modules\"",
        "\"public\"",
        "123",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(
            root,
            "spacepress.config.ts",
            &format!(
                "import {{ defineConfig }} from \"spacepress\";\nexport default defineConfig({{ name: \"bad-dir\", dir: {bad_dir} }});\n"
            ),
        );
        let msg = compile_err(root);
        assert!(
            msg.contains("dir"),
            "expected invalid dir diagnostic for {bad_dir}, got:\n{msg}"
        );
    }
}
