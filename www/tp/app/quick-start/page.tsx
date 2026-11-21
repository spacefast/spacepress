import { Link } from "typedpress/app";
import { Cmd, Code, Sandbox } from "../../components/Code";

export const metadata = {
  title: "Quick Start",
  description: "Go from zero to a running SpacePress application on local WordPress in minutes.",
};

const STARTER_SCHEMA = `import {
  collection, table, text, integer, richText, slug, ref,
  action, db, HttpError, defineConfig,
} from "typedpress";

export const notes = collection({
  title: text().min(1).max(120),
  slug: slug({ source: "title" }).optional(),
  content: richText().optional(),
}, {
  label: "Notes",
  url: "/notes/:slug",
  sync: "content/notes/*.md",
  access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
});

export const applause = table({
  noteId: ref(notes).unique().onDelete("cascade"),
  count: integer().default(0),
}, {
  access: { read: "anyone", create: "admin", update: "admin", delete: "admin" },
});

export const clap = action({
  input: { noteId: integer() },
  access: "anyone",
  async handler({ noteId }) {
    const existing = await db.query.applause.findFirst({ where: { noteId } });
    if (existing) {
      const [row] = await db.update(applause)
        .set({ count: existing.count + 1 })
        .where({ id: existing.id })
        .returning();
      return row;
    }
    const [row] = await db.insert(applause).values({ noteId, count: 1 }).returning();
    if (!row) throw new HttpError(500, "insert_failed", "Could not save clap");
    return row;
  },
});

export default defineConfig({ name: "my-app", seed: true });`;

const PAGE_SNIPPET = `import { db } from "typedpress";
import { Link, useFormState } from "typedpress/app";
import { greet } from "../actions";

export const metadata = { title: "Home" };

export default async function Home() {
  const latest = await db.query.notes.findMany({
    columns: { id: true, title: true, slug: true },
    orderBy: { publishedAt: "desc" },
    limit: 5,
  });
  const state = useFormState(greet);

  return (
    <section>
      <h1>Latest Notes</h1>
      <ul>
        {latest.map((note) => (
          <li key={note.id}>
            <Link href={\`/notes/\${note.slug}\`}>{note.title}</Link>
          </li>
        ))}
      </ul>

      <form action={greet}>
        <input name="name" defaultValue={state.values.name ?? ""} required />
        <button type="submit">Say hello</button>
      </form>
      {state.result && <p role="status">{state.result.message}</p>}
    </section>
  );
}`;

const ISLAND_SNIPPET = `"use client";
import { useState } from "typedpress/client";
import { clap } from "../schema";

export function ClapButton({ noteId, initial }: { noteId: number; initial: number }) {
  const [count, setCount] = useState(initial);
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await clap({ noteId });
        setCount(res.count);
        setBusy(false);
      }}
    >
      {count} {count === 1 ? "clap" : "claps"}
    </button>
  );
}`;

export default function QuickStartPage() {
  return (
    <>
      <section className="sp-page-banner">
        <div className="sp-container-steps">
          <h1>Quick Start</h1>
          <p>
            The famous 3-minute install: scaffold a TypeScript app, define collections and SQL tables, add a server action and TSX page, and launch local WordPress — no Docker or Rust toolchain required.
          </p>
        </div>
      </section>

      <div className="sp-container-steps">
        <div className="sp-callout" style={{ marginTop: "32px" }}>
          <strong>Requirements &amp; pre-release naming:</strong> You need <strong>Node.js 22+</strong> and npm. The <code>typedpress</code> npm package downloads a prebuilt Rust compiler binary automatically. During pre-release, CLI commands, config filenames (<code>typedpress.config.ts</code>), and imports (<code>from &quot;typedpress&quot;</code>) use the <code>typedpress</code> identifier.
        </div>

        <div className="sp-steps">
          <article className="sp-step">
            <div className="sp-step-head">
              <span className="sp-step-num">1</span>
              <h2>Scaffold a new project</h2>
            </div>
            <p style={{ color: "var(--ink-secondary)" }}>
              Run the scaffolder to create a complete SpacePress starter with a schema, sample Markdown notes, TSX pages, a progressive form action, and coding-agent files (<code>AGENTS.md</code> and <code>.mcp.json</code>).
            </p>
            <Cmd command="npm create typedpress@0.3.0 my-app" />
            <Cmd command="cd my-app && npm run dev" />
            <p style={{ color: "var(--ink-secondary)", marginBottom: 0 }}>
              <code>typedpress dev</code> compiles your TypeScript, boots a local WordPress + SQLite site, activates the generated plugins, and watches for file changes. Open the printed URL in your browser and say <em>Howdy</em> to the modern SpacePress Admin at <code>/wp-admin/new/</code>.
            </p>
          </article>

          <article className="sp-step">
            <div className="sp-step-head">
              <span className="sp-step-num">2</span>
              <h2>Define your schema &amp; server action (Try it live!)</h2>
            </div>
            <p style={{ color: "var(--ink-secondary)" }}>
              SpacePress reads <code>typedpress.config.ts</code> (and any files it re-exports from <code>tp/</code>). Edit the starter schema below — try adding a <code>summary: text().optional()</code> field or modifying the <code>clap</code> action — and inspect the live PHP, SQL migration, and TypeScript definitions generated in your browser.
            </p>
            <Sandbox
              eager
              title="Interactive Starter Schema"
              defaultTab="schema.php"
              presets={[
                {
                  label: "typedpress.config.ts",
                  description: "Click inside the editor to modify fields, access rules, or the action handler and watch the compiler react instantly.",
                  code: STARTER_SCHEMA,
                },
              ]}
            />
          </article>

          <article className="sp-step">
            <div className="sp-step-head">
              <span className="sp-step-num">3</span>
              <h2>Render a server TSX page &amp; interactive island</h2>
            </div>
            <p style={{ color: "var(--ink-secondary)" }}>
              Pages in <code>tp/app/</code> compile directly to PHP and render inside WordPress with zero Node.js. Forms bound to <code>action=&#123;greet&#125;</code> work even with JavaScript disabled; components marked <code>&quot;use client&quot;</code> compile into WordPress Interactivity API stores.
            </p>
            <Code file="tp/app/page.tsx" note="Server-rendered in PHP" code={PAGE_SNIPPET} />
            <Code file="tp/components/ClapButton.tsx" note="Hydrated via Interactivity API" code={ISLAND_SNIPPET} />
          </article>

          <article className="sp-step">
            <div className="sp-step-head">
              <span className="sp-step-num">4</span>
              <h2>Sync Markdown content &amp; verify types</h2>
            </div>
            <p style={{ color: "var(--ink-secondary)" }}>
              Collections with <code>sync: &quot;content/notes/*.md&quot;</code> stay in two-way sync between Git and WordPress. Run <code>typedpress sync</code> to push local Markdown files or pull edits made in WordPress Admin, and run <code>check</code> + <code>tsc</code> to validate everything before shipping.
            </p>
            <Cmd command="npx typedpress sync" />
            <Cmd command="npm run check && npm run typecheck" />
          </article>

          <article className="sp-step">
            <div className="sp-step-head">
              <span className="sp-step-num">5</span>
              <h2>Build &amp; deploy on Spacefast, Pressable, WordPress.com, or self-hosted WordPress</h2>
            </div>
            <p style={{ color: "var(--ink-secondary)" }}>
              Compile your project into standalone WordPress plugins under <code>tp/dist/wp-content/plugins/</code>, deploy directly to Spacefast, Pressable, WordPress.com, or any self-hosted WordPress site with <code>login</code> + <code>push</code>, or export a static site when <code>output: &quot;static&quot;</code> is set.
            </p>
            <Cmd command="npx typedpress build" />
            <Cmd command="npx typedpress login https://example.com && npx typedpress push" />
            <p style={{ color: "var(--ink-muted)", fontSize: "14px", marginBottom: 0 }}>
              Need to add a module later? Scaffold a WooCommerce storefront with <code>npx typedpress add shop</code>, SQL tables with <code>npx typedpress add db</code>, or OpenAPI reference pages with <code>npx typedpress add api-reference</code>.
            </p>
          </article>
        </div>

        <section style={{ marginBottom: "80px" }}>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "18px", letterSpacing: "-0.02em" }}>Where to go next</h2>
          <div className="sp-card-grid" style={{ marginTop: 0 }}>
            <Link href="/handbook" className="sp-card sp-card-link">
              <h3>Interactive Handbook →</h3>
              <p>Learn the complete architecture end-to-end with live embedded WASM sandboxes across all 14 sections.</p>
            </Link>
            <Link href="/play" className="sp-card sp-card-link">
              <h3>Open the Playground →</h3>
              <p>Switch between complete apps, inspect compiled diffs, share links, and run inside WordPress Playground.</p>
            </Link>
            <Link href="/docs" className="sp-card sp-card-link">
              <h3>Reference &amp; APIs →</h3>
              <p>Browse structured technical reference covering schema builders, access rules, sync, WooCommerce, and CLI.</p>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
