import { Link } from "spacepress/app";
import { Cmd, Code, Sandbox } from "../../components/Code";
import { PageActions } from "../../components/PageActions";

export const metadata = {
  title: "Quick Start", description: "Go from zero to a running SpacePress application on local WordPress in minutes.", };

const STARTER_SCHEMA = `import { collection, table, mutation, defineConfig, f } from "spacepress";
import { db, HttpError } from "spacepress/server";

export const notes = collection({
  title: f.text().min(1).max(120),
  slug: f.slug({ source: "title" }).optional(),
  content: f.richText().optional(),
}, {
  label: "Notes",
  url: "/notes/:slug",
  sync: "content/notes/*.md",
  access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
});

export const applause = table({
  noteId: f.ref(notes).unique().onDelete("cascade"),
  count: f.integer().default(0),
}, {
  access: { read: "anyone", create: "admin", update: "admin", delete: "admin" },
});

// POST /wp-json/spacepress/v1/actions/clap; islands call it as api.clap
export const clap = mutation({ access: "anyone" }, async ({ noteId }: { noteId: number }) => {
  const existing = await db.query.applause.findFirst({ where: { noteId } });
  if (existing) {
    const [row] = await db.update(applause)
      .set({ count: existing.count + 1 })
      .where({ id: existing.id })
      .returning();
    if (!row) throw new HttpError(404, "not_found", "Clap count not found");
    return row;
  }
  const [row] = await db.insert(applause).values({ noteId, count: 1 }).returning();
  if (!row) throw new HttpError(500, "insert_failed", "Could not save clap");
  return row;
});

export default defineConfig({ name: "my-app", seed: true });`;

const PAGE_SNIPPET = `import { db } from "spacepress/server";
import { Link, useFormState } from "spacepress/app";
import { greet } from "../actions";

export const metadata = { title: "Home" };

export default async function Home() {
  const latest = await db.query.notes.findMany({
    columns: { id: true, title: true, slug: true }, orderBy: { publishedAt: "desc" }, limit: 5, });
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
import { useState } from "react";
import { useMutation } from "spacepress/react";
import { api } from "../_generated/api";

export function ClapButton({ noteId, initial }: { noteId: number; initial: number }) {
  const [count, setCount] = useState(initial);
  const clap = useMutation(api.clap);

  return (
    <button
      type="button"
      disabled={clap.pending}
      onClick={async () => {
        const res = await clap.mutate({ noteId });
        setCount(res.count);
      }}
    >
      {count} {count === 1 ? "clap" : "claps"}
    </button>
  );
}`;

const AGENT_PROMPT =
  "Read https://spacepress.dev/start.md and https://spacepress.dev/rules.md, then help me build a SpacePress app (scaffold with `npm create spacepress@0.3.0 my-app`, verify with `npx spacepress check`, and boot local WordPress with `npm run dev`).";

export default function QuickStartPage() {
  return (
    <>
      <section className="sp-page-banner">
        <div className="sp-container-narrow">
          <div className="sp-article-head">
            <h1>Quick Start</h1>
            <PageActions mdPath="/md/quick-start.md" title="SpacePress Quick Start" />
          </div>
          <p>
            The famous 3-minute install: hand the prompt to your coding agent — or scaffold directly with the CLI — and launch local WordPress with no Docker or Rust toolchain required.
          </p>
        </div>
      </section>

      <div className="sp-container-narrow">
        <div className="sp-callout" style={{ marginTop: "32px" }}>
          <strong>Requirements &amp; pre-release naming:</strong> You need <strong>Node.js 22+</strong> and npm. The <code>spacepress</code> npm package downloads a prebuilt Rust compiler binary automatically. During pre-release, CLI commands, config filenames (<code>spacepress.config.ts</code>), and imports (<code>from &quot;spacepress&quot;</code>) use the <code>spacepress</code> identifier.
        </div>

        <div className="sp-steps">
          <article className="sp-step">
            <div className="sp-step-head">
              <span className="sp-step-num">1</span>
              <h2>Start with your coding agent — or the CLI</h2>
            </div>
            <p style={{ color: "var(--ink-secondary)" }}>
              Paste this prompt into Claude Code, Cursor, Codex, or any coding agent. It reads{" "}
              <a href="/start.md"><code>/start.md</code></a> and <a href="/rules.md"><code>/rules.md</code></a>, scaffolds the starter with <code>AGENTS.md</code>, 10 skills, and{" "}
              <Link href="/docs/operations/mcp-and-agents"><code>.mcp.json</code></Link>, and boots local WordPress:
            </p>
            <div className="sp-cmd">
              <code style={{ whiteSpace: "normal", lineHeight: 1.5 }}>{AGENT_PROMPT}</code>
              <button type="button" className="sp-copy-inline" data-copy={AGENT_PROMPT}>
                Copy prompt
              </button>
            </div>
            <p style={{ color: "var(--ink-muted)", fontSize: "14px", marginTop: "18px" }}>
              Or run the scaffolder directly in your terminal:
            </p>
            <Cmd command="npm create spacepress@0.3.0 my-app" />
            <Cmd command="cd my-app && npm run dev" />
            <p style={{ color: "var(--ink-secondary)", marginBottom: 0 }}>
              <code>spacepress dev</code> compiles your TypeScript, boots a local WordPress + SQLite site, activates the generated plugins, and watches for file changes. Open the printed URL in your browser and say <em>Howdy</em> to the modern SpacePress Admin at <code>/wp-admin/new/</code>.
            </p>
          </article>

          <article className="sp-step">
            <div className="sp-step-head">
              <span className="sp-step-num">2</span>
              <h2>Define your schema &amp; a mutation</h2>
            </div>
            <p style={{ color: "var(--ink-secondary)" }}>
              SpacePress reads <code>spacepress.config.ts</code> and every <code>.ts</code> file under <code>sp/</code>. Edit the starter schema below — try adding a <code>summary: f.text().optional()</code> field or modifying the <code>clap</code> mutation — and inspect the live PHP, SQL migration, and TypeScript definitions generated in your browser.
            </p>
            <Sandbox
              eager
              title="Interactive Starter Schema"
              defaultTab="schema.php"
              presets={[
                {
                  label: "spacepress.config.ts",
                  description: "Click inside the editor to modify fields, access rules, or the mutation handler and watch the compiler react instantly.",
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
              Pages in <code>sp/app/</code> compile directly to PHP and render inside WordPress with zero Node.js. Forms bound to <code>action=&#123;greet&#125;</code> work even with JavaScript disabled; components marked <code>&quot;use client&quot;</code> compile into WordPress Interactivity API stores and call mutations through the generated, typed <code>api</code>.
            </p>
            <Code file="sp/app/page.tsx" note="Server-rendered in PHP" code={PAGE_SNIPPET} />
            <Code file="sp/components/ClapButton.tsx" note="Hydrated via Interactivity API" code={ISLAND_SNIPPET} />
          </article>

          <article className="sp-step">
            <div className="sp-step-head">
              <span className="sp-step-num">4</span>
              <h2>Sync Markdown content &amp; verify types</h2>
            </div>
            <p style={{ color: "var(--ink-secondary)" }}>
              Collections with <code>sync: &quot;content/notes/*.md&quot;</code> stay in two-way sync between Git and WordPress. Run <code>spacepress sync</code> to push local Markdown files or pull edits made in WordPress Admin, and run <code>check</code> + <code>tsc</code> to validate everything before shipping.
            </p>
            <Cmd command="npx spacepress sync" />
            <Cmd command="npm run check && npm run typecheck" />
          </article>

          <article className="sp-step">
            <div className="sp-step-head">
              <span className="sp-step-num">5</span>
              <h2>Build &amp; deploy anywhere WordPress runs</h2>
            </div>
            <p style={{ color: "var(--ink-secondary)" }}>
              Compile your project into standalone WordPress plugins under <code>sp/dist/wp-content/plugins/</code>, deploy to{" "}
              <Link href="/docs/operations/deploy-spacefast">Spacefast</Link>,{" "}
              <Link href="/docs/operations/deploy-wp-cloud">Pressable &amp; WordPress.com (WP Cloud)</Link>, or{" "}
              <Link href="/docs/operations/deploy-self-hosted">self-hosted WordPress</Link> with <code>login</code> + <code>push</code>, or export a static site when <code>output: &quot;static&quot;</code> is set.
            </p>
            <Cmd command="npx spacepress build" />
            <Cmd command="npx spacepress login https://example.com && npx spacepress push" />
            <p style={{ color: "var(--ink-muted)", fontSize: "14px", marginBottom: 0 }}>
              Need to add a module later? Scaffold a WooCommerce storefront with <code>npx spacepress add shop</code>, SQL tables with <code>npx spacepress add db</code>, or OpenAPI reference pages with <code>npx spacepress add api-reference</code>.
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
