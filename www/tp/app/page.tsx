import { Link } from "typedpress/app";
import { Sandbox, Tree } from "../components/Code";

export const metadata = {
  title: "SpacePress — The TypeScript Framework for WordPress",
  description: "Write TypeScript schemas, server actions, background jobs, and React TSX pages. SpacePress compiles them with Rust into native PHP, SQL migrations, OpenAPI, and WordPress plugins.",
};

const AUTHORED_TREE = `my-app/
  typedpress.config.ts   Project config & exports
  tp/
    schema.ts            Collections, SQL tables, globals, taxonomies, stores
    server.ts            Server actions, Action Scheduler jobs & mail
    app/
      layout.tsx         Root layout & shared metadata
      page.tsx           Server-rendered TSX pages
      api/feed/route.ts  Custom HTTP route handlers
    components/
      TaskList.tsx       "use client" Interactivity API islands
    wp-hooks/
      the_content.ts     Typed WordPress core filters & actions
  content/
    posts/hello.md       Two-way Git-synced Markdown
  emails/
    welcome.tsx          React Email templates`;

const GENERATED_TREE = `my-app/
  tp/
    app/
      schema.php         Post types, tables, routes & access rules
      functions.php      Compiled PHP handlers, hooks, jobs & SSR pages
    _generated/
      migrations/
        0001_init.sql    Numbered SQL migrations
        snapshot.json    Schema ledger & safe rename tracking
      db.d.ts            Strict TypeScript database types
      openapi.json       Validated OpenAPI 3.1 specification
      client/
        index.ts         Typed fetch client, React & Woo cart hooks
    dist/wp-content/plugins/
      typedpress-runtime/  Native PHP runtime — zero Node.js
      typedpress-identity/ Passkeys, TOTP, JWT & tokens
      typedpress-admin/    Modern Admin at /wp-admin/new/`;

const HERO_SCHEMA_CODE = `import {
  wp, table, text, integer, boolean,
  ref, action, db, HttpError, defineConfig,
} from "typedpress";

// Native WordPress posts extended with typed fields, URL routing & Markdown sync
export const posts = wp.posts.extend({
  subtitle: text().max(200).optional(),
}, {
  url: "/blog/:slug",
  sync: "content/posts/*.md",
  comments: { moderation: "first-time", threaded: 2 },
});

// Relational SQL table: automatic numbered migrations
export const tasks = table({
  title: text().min(1).max(120),
  done: boolean().default(false),
  postId: ref(posts).optional().onDelete("cascade"),
}, {
  access: { read: "anyone", create: "authenticated", update: "authenticated", delete: "editor" },
});

// Compiled to native PHP: POST /__tp/api/v1/actions/completeTask
export const completeTask = action({
  input: { id: integer() },
  access: "authenticated",
  async handler({ id }) {
    const [row] = await db.update(tasks).set({ done: true }).where({ id }).returning();
    if (!row) throw new HttpError(404, "not_found", "Task not found");
    return row;
  },
});

export default defineConfig({ name: "starter" });`;

const HERO_JOBS_CODE = `import {
  table, text, integer, timestamp, action, job, jobs, db, defineConfig,
} from "typedpress";

export const subscriptions = table({
  email: text().max(191).unique(),
  plan: text().default("free"),
  welcomedAt: timestamp().optional(),
}, {
  access: { read: "admin", create: "anyone", update: "admin", delete: "admin" },
}).on({
  async afterCreate(row) {
    // Queued in-transaction, delivered after commit on Action Scheduler
    await jobs.sendWelcome.enqueue({ id: row.id }, { key: \`welcome-\${row.id}\` });
  },
});

export const sendWelcome = job({
  input: { id: integer() },
  retries: 3,
  async handler({ id }) {
    await db.update(subscriptions)
      .set({ welcomedAt: new Date().toISOString() })
      .where({ id });
  },
});

export const upgradePlan = action({
  input: { id: integer(), plan: text().max(32) },
  access: "editor",
  async handler({ id, plan }) {
    const [row] = await db.update(subscriptions).set({ plan }).where({ id }).returning();
    return row;
  },
});

export default defineConfig({ name: "jobs-demo" });`;

const HERO_ACCESS_CODE = `import {
  collection, userProjection, text, email, select, integer, defineConfig,
} from "typedpress";

// Projects onto wp_users & wp_usermeta with declarative rules
export const members = userProjection({
  email: email().unique().max(191),
  name: text().max(80),
  tier: select(["free", "pro", "team"]).default("free"),
}, {
  access: { read: "self", create: "anyone", update: "self", delete: "admin" },
});

// Row-level filters & field-level access rules compile to PHP + SQL
export const notes = collection({
  title: text().min(1).max(120),
  ownerId: integer(),
  internalNotes: text({ multiline: true })
    .access({ read: "editor", create: "editor", update: "editor" })
    .optional(),
}, {
  label: "Notes",
  access: {
    read: (ctx) => ctx.user?.role === "editor" || ctx.user?.role === "admin"
      ? true
      : { ownerId: ctx.user?.id ?? -1 },
    create: "authenticated",
    update: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }),
    delete: "editor",
  },
});

export default defineConfig({ name: "access-demo" });`;

const HERO_WOO_CODE = `import {
  store, product, productCategory, productTag, order, defineConfig,
} from "typedpress";

// Native WooCommerce runtime: source declares currency, shipping & payments
export const shop = store({
  currency: "USD",
  country: "US",
  sellTo: ["US", "CA"],
  shipping: [
    {
      name: "Domestic",
      countries: ["US"],
      methods: [
        { type: "flatRate", title: "Standard Shipping", cost: "8.00" },
        { type: "freeShipping", title: "Free over $75", minimum: "75.00" },
      ],
    },
  ],
  payments: ["cod"],
  email: { fromName: "SpacePress Goods", fromAddress: "orders@example.com" },
});

export const products = product({ sync: "content/products/*.md", url: "/products/:slug" });
export const categories = productCategory({ url: "/shop/:path" });
export const tags = productTag();
export const orders = order();

export default defineConfig({ name: "storefront" });`;

const MIGRATION_BASE = `import { table, text, boolean, defineConfig } from "typedpress";

export const issues = table({
  title: text().min(1).max(160),
  closed: boolean().default(false),
});

export default defineConfig({ name: "tracker" });`;

const MIGRATION_NEXT = `import { table, text, integer, boolean, select, timestamp, defineConfig } from "typedpress";

// Edit this schema! Add a column, change a default, or rename with .was("title")
export const issues = table({
  title: text().min(1).max(160),
  priority: integer().default(2).min(1).max(5),
  status: select(["triage", "active", "done"]).default("triage"),
  closed: boolean().default(false),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()),
}).index(["status", "priority"]);

export default defineConfig({ name: "tracker" });`;

export default function HomePage() {
  return (
    <>
      <section className="sp-hero">
        <div className="sp-hero-grid-bg" aria-hidden="true" />
        <div className="sp-container sp-hero-inner">
          <div className="sp-hero-top">
            <h1>
              The TypeScript framework that{" "}
              <span className="sp-hero-accent">compiles to WordPress.</span>
            </h1>
            <p className="sp-hero-sub">
              Define collections, SQL tables, access rules, server actions, background jobs, and React TSX pages in TypeScript. SpacePress compiles them into native PHP, SQL migrations, OpenAPI 3.1, a typed client, and standard WordPress plugins.
            </p>
            <div className="sp-hero-ctas">
              <Link href="/quick-start" className="sp-btn sp-btn-primary sp-btn-lg">
                Quick Start →
              </Link>
              <Link href="/handbook" className="sp-btn sp-btn-secondary sp-btn-lg">
                Read the Handbook
              </Link>
              <Link href="/play" className="sp-btn sp-btn-ghost sp-btn-lg">
                Open Playground
              </Link>
            </div>
            <div className="sp-cli-pill">
              <span>
                <span className="sp-prompt">$ </span>
                <code>npm create typedpress@0.3.0 my-app</code>
              </span>
              <button type="button" className="sp-copy-inline" data-copy="npm create typedpress@0.3.0 my-app">
                Copy
              </button>
            </div>
            <p className="sp-prerelease-note">
              Pre-release note: while SpacePress prepares its stable release, the CLI, config file (<code>typedpress.config.ts</code>), and package imports use the pre-release identifier <code>typedpress</code>.
            </p>
          </div>

          <Sandbox
            eager
            playExample="tasks"
            defaultTab="schema.php"
            presets={[
              {
                label: "Schema & Actions",
                description: "Edit the TypeScript on the left — the real Rust compiler runs in WebAssembly right in your browser to emit PHP, SQL migrations, db.d.ts, and OpenAPI.",
                output: "schema.php",
                code: HERO_SCHEMA_CODE,
              },
              {
                label: "Hooks & Jobs",
                description: "Lifecycle hooks run inside the write transaction; background jobs enqueue onto WordPress Action Scheduler with retries and dedupe keys.",
                output: "functions.php",
                code: HERO_JOBS_CODE,
              },
              {
                label: "Access Control",
                description: "Row-level filters and field-level .access() rules compile directly into PHP guards and SQL predicates — never bypassed by REST or client queries.",
                output: "schema.php",
                code: HERO_ACCESS_CODE,
              },
              {
                label: "WooCommerce Store",
                description: "Declare currency, shipping zones, products, categories, tags, and orders in TypeScript; SpacePress wires native WooCommerce and optimistic cart hooks.",
                output: "schema.php",
                code: HERO_WOO_CODE,
              },
            ]}
          />
        </div>
      </section>

      <section className="sp-section">
        <div className="sp-container">
          <div className="sp-section-head">
            <h2>One TypeScript codebase, standard WordPress output</h2>
            <p>
              SpacePress never ships a Node.js server or a JS runtime to production. Its Rust compiler analyzes your TypeScript once and emits deterministic PHP, SQL, types, and WordPress plugins.
            </p>
          </div>

          <div className="sp-pipeline">
            <div>
              <p className="sp-pipeline-label">Source</p>
              <Tree text={AUTHORED_TREE} />
            </div>

            <div className="sp-pipe-arrow">
              <div style={{ fontSize: "24px", lineHeight: 1 }}>→</div>
              <small>typedpress build</small>
            </div>

            <div>
              <p className="sp-pipeline-label">Compiled output</p>
              <Tree text={GENERATED_TREE} />
            </div>
          </div>
        </div>
      </section>

      <section className="sp-section sp-section-subtle">
        <div className="sp-container">
          <div className="sp-section-head">
            <h2>Built on WordPress primitives</h2>
            <p>
              Keep WordPress&apos;s ecosystem — Gutenberg, media library, comments, WooCommerce, PHP hosting — while authoring with end-to-end TypeScript safety.
            </p>
          </div>

          <div className="sp-bento">
            <div className="sp-card sp-span-6">
              <h3>Collections &amp; SQL tables, side by side</h3>
              <p>
                Use <code>collection()</code> for editorial content backed by WordPress posts (Gutenberg, drafts, revisions, staged versions, comments, URL routing) and <code>table()</code> for relational app data in dedicated SQL tables with compound indexes and automatic migrations. Add <code>global()</code> for singletons and <code>wp.posts.extend()</code> for built-in posts.
              </p>
            </div>

            <div className="sp-card sp-span-6">
              <h3>TSX pages &amp; &quot;use client&quot; islands</h3>
              <p>
                File-based routing in <code>tp/app/</code> compiles React-style TSX pages and layouts into server-rendered PHP — write <code>.map()</code> instead of wrestling The Loop by hand. Mark interactive widgets with <code>&quot;use client&quot;</code> to compile them into WordPress Interactivity API stores with <code>useState</code>, <code>useLive</code>, and zero-JS progressive <code>&lt;form action=&#123;...&#125;&gt;</code>.
              </p>
            </div>

            <div className="sp-card sp-span-4">
              <h3>Row &amp; field access</h3>
              <p>
                Write access functions once in TypeScript. Returning a filter scopes queries to matching rows automatically; field-level <code>.access()</code> strips unauthorized columns across REST, pages, and client calls.
              </p>
            </div>

            <div className="sp-card sp-span-4">
              <h3>Actions, jobs, hooks &amp; routes</h3>
              <p>
                Define typed RPC endpoints with <code>action()</code>, retryable Action Scheduler queues with <code>job()</code>, type-safe <code>add_action</code>/<code>add_filter</code> hooks in <code>tp/wp-hooks/</code>, and custom endpoints via <code>route.ts</code>.
              </p>
            </div>

            <div className="sp-card sp-span-4">
              <h3>WooCommerce &amp; React Email</h3>
              <p>
                Configure WooCommerce stores, products, shipping, and orders in TypeScript with optimistic cart hooks, and render transactional emails from <code>emails/*.tsx</code> with <code>mail.render()</code> &amp; <code>mail.send()</code>.
              </p>
            </div>

            <div className="sp-card sp-span-4">
              <h3>Two-way Markdown &amp; Git sync</h3>
              <p>
                Bind any collection with <code>sync: &quot;content/**/*.md&quot;</code>. Edit in VS Code or WordPress Admin — <code>typedpress sync</code> performs 3-way merges with stable UIDs and schema-validated YAML front matter.
              </p>
            </div>

            <div className="sp-card sp-span-4">
              <h3>Admin, Gutenberg &amp; screens</h3>
              <p>
                Ships <code>typedpress-admin</code> at <code>/wp-admin/new/</code>, declarative <code>adminScreen()</code> DataViews/DataForms, and <code>@typedpress/blocks</code> to author Gutenberg blocks and block themes in TSX.
              </p>
            </div>

            <div className="sp-card sp-span-4">
              <h3>MCP server, Abilities &amp; Astro</h3>
              <p>
                Expose actions as WordPress Abilities with <code>readonly</code>/<code>destructive</code> annotations, run <code>typedpress mcp</code> for coding agents, or connect external frontends with <code>@typedpress/astro</code> and React hooks.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="sp-section">
        <div className="sp-container">
          <div className="sp-section-head">
            <h2>Change a schema, get an instant SQL migration</h2>
            <p>
              SpacePress tracks a schema snapshot in <code>tp/_generated/migrations/snapshot.json</code>. Try adding a field, changing a type, or renaming <code>title</code> with <code>.was(&quot;title&quot;)</code> below — watch the incremental <code>0002_*.sql</code> migration update live.
            </p>
          </div>

          <Sandbox
            title="Live Schema Evolution -> Incremental SQL Migration"
            base={MIGRATION_BASE}
            defaultTab="0002"
            diff
            presets={[
              {
                label: "Schema Diff",
                description: "Compiled against a baseline snapshot containing only `title` and `closed`. Edit the TypeScript to generate a fresh SQL migration in real time.",
                output: "0002",
                code: MIGRATION_NEXT,
              },
            ]}
          />
        </div>
      </section>

      <section className="sp-section sp-section-subtle">
        <div className="sp-container">
          <div className="sp-section-head">
            <h2>Edit a complete app and boot it inside WordPress Playground</h2>
            <p>
              Every SpacePress build produces standard WordPress plugins. Click below to open the full multi-file <strong>Tasks</strong> app, edit its schema, page, or live <code>&quot;use client&quot;</code> island, inspect every compiled artifact, and click <strong>Run in WordPress</strong> to launch it live in-tab.
            </p>
          </div>

          <tp-play
            example="tasks"
            hint="Multi-file Tasks app: SQL table, two server actions, TSX page, and live Interactivity API island — compile and run in WordPress Playground."
          />
        </div>
      </section>

      <section className="sp-section">
        <div className="sp-container">
          <div className="sp-section-head">
            <h2>What developers are saying</h2>
          </div>

          <div className="sp-quotes-grid">
            <figure className="sp-quote-card">
              <blockquote>&ldquo;This is wildddddd&rdquo;</blockquote>
              <figcaption className="sp-quote-author">
                <a
                  className="sp-quote-avatar-link"
                  href="https://gravatar.com/srubenstein"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Seth Rubenstein on Gravatar"
                >
                  <img
                    className="sp-quote-avatar"
                    src="https://1.gravatar.com/avatar/1dbea249f39ebe090ce44bf103c993dd29d56dda5b94f70525222d7a728cc7bb?s=160"
                    alt="Seth Rubenstein"
                    width={44}
                    height={44}
                    loading="lazy"
                    decoding="async"
                  />
                </a>
                <div className="sp-quote-meta">
                  <a
                    className="sp-quote-name"
                    href="https://gravatar.com/srubenstein"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Seth Rubenstein
                  </a>
                  <span className="sp-quote-role">Head of Engineering, Pew Research Center</span>
                  <div className="sp-quote-links">
                    <a href="https://gravatar.com/srubenstein" target="_blank" rel="noopener noreferrer">
                      Gravatar ↗
                    </a>
                    <span aria-hidden="true">·</span>
                    <a href="https://x.com/SethRubenstein" target="_blank" rel="noopener noreferrer">
                      @SethRubenstein ↗
                    </a>
                  </div>
                </div>
              </figcaption>
            </figure>

            <figure className="sp-quote-card">
              <blockquote>
                &ldquo;duuuude no fucking way [..] This is so exciting. [..] it&apos;s going to be a literally absurd&rdquo;
              </blockquote>
              <figcaption className="sp-quote-author">
                <a
                  className="sp-quote-avatar-link"
                  href="https://gravatar.com/jameswlepage576d19b1f7"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="James LePage on Gravatar"
                >
                  <img
                    className="sp-quote-avatar"
                    src="https://1.gravatar.com/avatar/629816b02cf290becaead8afbfb01622c182c0059ce2497ffe33685757d715f6?s=160"
                    alt="James LePage"
                    width={44}
                    height={44}
                    loading="lazy"
                    decoding="async"
                  />
                </a>
                <div className="sp-quote-meta">
                  <a
                    className="sp-quote-name"
                    href="https://gravatar.com/jameswlepage576d19b1f7"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    James LePage
                  </a>
                  <span className="sp-quote-role">Co-founder, Parisi Labs · ex-Head of AI, Automattic</span>
                  <div className="sp-quote-links">
                    <a href="https://gravatar.com/jameswlepage576d19b1f7" target="_blank" rel="noopener noreferrer">
                      Gravatar ↗
                    </a>
                    <span aria-hidden="true">·</span>
                    <a href="https://x.com/jameswlepage" target="_blank" rel="noopener noreferrer">
                      @jameswlepage ↗
                    </a>
                  </div>
                </div>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="sp-section sp-section-subtle">
        <div className="sp-container">
          <div className="sp-section-head">
            <h2>Deploy on Spacefast, Pressable, WordPress.com, or Self-hosted WordPress</h2>
            <p>
              Production output is standard PHP and WordPress plugins — zero Node.js server required. Push directly with <code>typedpress push</code> or upload the compiled plugin bundle anywhere PHP 8.2+ and WordPress 7.1+ run.
            </p>
          </div>

          <div className="sp-deploy-grid">
            <Link className="sp-deploy-card" href="/docs/operations/deploy-spacefast">
              <strong>Spacefast →</strong>
              <span>Instant cloud deployment built for SpacePress apps and AI workflows.</span>
            </Link>
            <Link className="sp-deploy-card" href="/docs/operations/deploy-pressable">
              <strong>Pressable →</strong>
              <span>Managed WordPress hosting on WP Cloud — runs spacepress.dev itself.</span>
            </Link>
            <Link className="sp-deploy-card" href="/docs/operations/deploy-wordpress-com">
              <strong>WordPress.com →</strong>
              <span>Deploy standard SpacePress plugins directly to plugin-enabled WordPress.com sites.</span>
            </Link>
            <Link className="sp-deploy-card" href="/docs/operations/deploy-self-hosted">
              <strong>Self-hosted WordPress →</strong>
              <span>Run on your own VPS, Docker stack, or any LAMP/LEMP host with zero lock-in.</span>
            </Link>
          </div>

          <figure className="sp-freedoms">
            <div className="sp-freedoms-head">
              <h3>The Four Freedoms</h3>
              <p>
                Like WordPress, SpacePress compiles to standard GPL plugins and SQL tables you own outright — move hosts, inspect every generated line of PHP, or eject anytime.
              </p>
            </div>
            <ol className="sp-freedoms-list" start={0}>
              <li>
                <span className="sp-freedom-num">0.</span>
                <blockquote>&ldquo;The freedom to run the program for any purpose.&rdquo;</blockquote>
              </li>
              <li>
                <span className="sp-freedom-num">1.</span>
                <blockquote>&ldquo;The freedom to study how the program works and change it to make it do what you wish.&rdquo;</blockquote>
              </li>
              <li>
                <span className="sp-freedom-num">2.</span>
                <blockquote>&ldquo;The freedom to redistribute.&rdquo;</blockquote>
              </li>
              <li>
                <span className="sp-freedom-num">3.</span>
                <blockquote>&ldquo;The freedom to distribute copies of your modified versions to others.&rdquo;</blockquote>
              </li>
            </ol>
            <figcaption className="sp-freedoms-cite">
              —{" "}
              <a href="https://wordpress.org/about/philosophy/" target="_blank" rel="noopener noreferrer">
                WordPress Philosophy: The Bill of Rights ↗
              </a>
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="sp-section">
        <div className="sp-container">
          <div className="sp-cta-band">
            <h2>Ship your next WordPress app in TypeScript</h2>
            <p>
              Deploy to Spacefast, Pressable, WordPress.com, or self-hosted WordPress in minutes — no Docker or Rust toolchain required.
            </p>
            <div className="sp-hero-ctas" style={{ marginBottom: 0 }}>
              <Link href="/quick-start" className="sp-btn sp-btn-primary sp-btn-lg">
                Start the Quick Start →
              </Link>
              <Link href="/handbook" className="sp-btn sp-btn-secondary sp-btn-lg">
                Read the Handbook
              </Link>
              <Link href="/examples" className="sp-btn sp-btn-ghost sp-btn-lg">
                Browse Examples
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
