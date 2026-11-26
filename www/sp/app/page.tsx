import { Link } from "spacepress/server/app";
import { Sandbox, Tree } from "../components/Code";

export const metadata = {
  title: "SpacePress — The TypeScript Framework for WordPress", description: "Write TypeScript schemas, server actions, background jobs, and React TSX pages. SpacePress compiles them with Rust into native PHP, SQL migrations, OpenAPI, and WordPress plugins.", };

const AUTHORED_TREE = `my-app/
  spacepress.config.ts   Project config & exports
  sp/
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
  sp/
    app/
      schema.php         Post types, tables, routes & access rules
      functions.php      Compiled PHP handlers, hooks, jobs & SSR pages
    _generated/
      migrations/
        <id>/            Forward-only migration entry
          ops.json       Schema operations
          migration.sql  SQL applied to the database
      db.d.ts            Strict TypeScript database types
      openapi.json       Validated OpenAPI 3.1 specification
      client/
        index.ts         Typed fetch client, React & Woo cart hooks
    dist/wp-content/plugins/
      spacepress-runtime/  Native PHP runtime — zero Node.js
      spacepress-identity/ Passkeys, TOTP, JWT & tokens
      spacepress-admin/    Modern Admin at /wp-admin/new/`;

const HERO_SCHEMA_CODE = `import {
  wp, table, text, integer, boolean, ref, action, defineConfig } from "spacepress";
import { db, HttpError } from "spacepress/server";

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

// Compiled to native PHP: POST /__sp/api/v1/actions/completeTask
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

const HERO_JOBS_CODE = `import { table, text, integer, timestamp, action, job, jobs, defineConfig } from "spacepress";
import { db } from "spacepress/server";

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
} from "spacepress";

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
} from "spacepress";

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

const MIGRATION_BASE = `import { table, text, boolean, defineConfig } from "spacepress";

export const issues = table({
  title: text().min(1).max(160),
  closed: boolean().default(false),
});

export default defineConfig({ name: "tracker" });`;

const MIGRATION_NEXT = `import { table, text, integer, boolean, select, timestamp, defineConfig } from "spacepress";

// Edit this schema! Add a column, change a default, or rename with .was("title")
export const issues = table({
  title: text().min(1).max(160),
  priority: integer().default(2).min(1).max(5),
  status: select(["triage", "active", "done"]).default("triage"),
  closed: boolean().default(false),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()),
}).index(["status", "priority"]);

export default defineConfig({ name: "tracker" });`;

const AGENT_PROMPT =
  "Read https://spacepress.dev/start.md and https://spacepress.dev/rules.md, then help me build a SpacePress app (scaffold with `npm create spacepress@0.3.0 my-app`, verify with `npx spacepress check`, and boot local WordPress with `npm run dev`).";

function WpCloudLogo() {
  return (
    <svg
      className="sp-wpcloud-logo"
      width="96"
      height="18"
      viewBox="0 0 181 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="WP Cloud"
    >
      <path d="M53.0978 1.003H46.8446C44.0016 0.899245 41.3315 2.37263 39.8996 4.87668L36.8699 10.3275L33.8124 4.86285C32.4981 2.51097 29.8834 0.996087 27.158 0.996087C24.3911 0.996087 21.8317 2.46947 20.469 4.85593L17.3908 10.3552L14.3264 4.8836C13.3303 3.10586 11.6979 1.82616 9.72643 1.27278C7.76192 0.726313 5.70057 0.968418 3.92282 1.96451C2.14508 2.97443 0.858466 4.59999 0.298166 6.5645C-0.262134 8.52901 -0.0200288 10.5973 0.969143 12.375L10.7364 29.8066L10.7571 29.7927C11.4281 30.9825 12.4173 32.0201 13.69 32.7464C14.8867 33.3828 16.1664 33.6872 17.4184 33.6872C20.0954 33.6872 22.6548 32.2899 24.0452 29.8066L27.1511 24.3004L30.2293 29.7997L30.2431 29.7927C30.9072 30.9687 31.8756 31.9855 33.1276 32.698C34.1652 33.3482 35.4103 33.6872 36.7108 33.6872C37.3195 33.6872 37.9351 33.6111 38.5508 33.4658C40.6536 32.9539 42.4521 31.6189 43.5104 29.7927L48.0482 21.658H53.0978C58.9498 21.658 63.5291 17.1479 63.5291 11.3928C63.536 5.65834 58.853 1.003 53.0978 1.003ZM3.00282 7.33232C3.35561 6.08721 4.17185 5.05653 5.29936 4.42706C6.41996 3.79759 7.72733 3.63849 8.97244 3.99127C10.2176 4.33714 11.2482 5.14646 11.8777 6.26706L15.7791 13.2397L10.7018 22.3152C10.5357 22.6126 10.3974 22.917 10.2798 23.2282L3.42478 10.9985C2.79531 9.87788 2.64313 8.57743 3.00282 7.33232ZM21.5965 28.43C20.3099 30.7404 17.4184 31.5428 15.0458 30.2839C12.7147 28.9558 11.8639 26.0021 13.1505 23.6848L22.9177 6.24631C23.7754 4.74526 25.401 3.81142 27.1649 3.81142C28.8873 3.81142 30.5405 4.76601 31.3706 6.23247L35.272 13.212L30.2016 22.329C30.0356 22.6195 29.9041 22.9239 29.7866 23.2282L27.1718 18.5591L21.5965 28.43ZM53.0978 18.8427H46.395L41.0617 28.4024C40.3977 29.5506 39.2356 30.4015 37.8798 30.7335C36.6831 31.024 35.4864 30.8718 34.6079 30.3046L34.5387 30.2631C32.2076 28.9488 31.3637 26.009 32.6503 23.6986L42.3553 6.25322C43.2268 4.73142 44.8247 3.8045 46.6094 3.8045C46.6716 3.8045 46.7408 3.8045 46.8031 3.81142H53.1047C57.3104 3.81142 60.7276 7.21473 60.7276 11.3928C60.7207 15.5708 57.3727 18.8427 53.0978 18.8427Z" fill="currentColor" />
      <path d="M76.4782 25.7185L71.982 9.04089H74.6936L78 22.8409L81.8045 9.04089H84.5853L88.2722 22.8409L91.5787 9.04089H94.2902L89.7248 25.6977H86.7781L83.1396 12.6379L79.3835 25.6977L76.4782 25.7185Z" fill="currentColor" />
      <path d="M96.6075 9.04089H102.439C103.739 9.04089 104.818 9.26224 105.676 9.69803C106.534 10.1338 107.17 10.7287 107.592 11.4827C108.014 12.2367 108.222 13.0875 108.222 14.0421C108.222 14.9483 108.021 15.7783 107.613 16.5254C107.212 17.2794 106.575 17.8812 105.725 18.3239C104.867 18.7666 103.774 18.9879 102.439 18.9879H99.1323V25.6977H96.6075V9.04089ZM99.1323 16.9128H102.321C103.511 16.9128 104.362 16.6568 104.881 16.138C105.399 15.6192 105.655 14.9206 105.655 14.0352C105.655 13.1152 105.399 12.3958 104.881 11.8839C104.362 11.372 103.511 11.1092 102.321 11.1092H99.1323V16.9128Z" fill="currentColor" />
      <path d="M124.138 25.9744C122.492 25.9744 121.067 25.6147 119.87 24.8953C118.674 24.1759 117.747 23.166 117.097 21.8725C116.446 20.5789 116.121 19.0848 116.121 17.3901C116.121 15.6746 116.446 14.1735 117.097 12.88C117.747 11.5864 118.674 10.5765 119.87 9.84329C121.067 9.11698 122.492 8.75036 124.138 8.75036C126.089 8.75036 127.68 9.22766 128.918 10.1753C130.156 11.1299 130.938 12.458 131.277 14.1735H128.469C128.247 13.2051 127.77 12.4373 127.044 11.8631C126.317 11.289 125.342 11.0054 124.118 11.0054C122.45 11.0054 121.136 11.5726 120.168 12.707C119.199 13.8415 118.715 15.3979 118.715 17.3831C118.715 19.3476 119.199 20.8971 120.168 22.0246C121.136 23.1521 122.45 23.7124 124.118 23.7124C125.342 23.7124 126.317 23.4427 127.044 22.9031C127.77 22.3636 128.247 21.6234 128.469 20.6896H131.277C130.945 22.3428 130.156 23.6294 128.918 24.5702C127.68 25.5109 126.089 25.9744 124.138 25.9744Z" fill="currentColor" />
      <path d="M133.961 25.6908V8.5636H136.486V25.6908H133.961Z" fill="currentColor" />
      <path d="M145.195 25.9744C144.067 25.9744 143.057 25.7185 142.158 25.1997C141.259 24.6809 140.553 23.9615 140.027 23.0346C139.502 22.1076 139.246 21.0216 139.246 19.7903C139.246 18.5591 139.509 17.4731 140.041 16.5392C140.574 15.6123 141.293 14.8929 142.192 14.3741C143.099 13.8622 144.102 13.5994 145.215 13.5994C146.343 13.5994 147.353 13.8553 148.252 14.3741C149.144 14.8929 149.864 15.6123 150.396 16.5392C150.929 17.4661 151.192 18.5522 151.192 19.7903C151.192 21.0285 150.929 22.1076 150.396 23.0346C149.864 23.9615 149.144 24.6809 148.245 25.1997C147.332 25.7185 146.315 25.9744 145.195 25.9744ZM145.195 23.8093C145.796 23.8093 146.357 23.6571 146.869 23.3597C147.387 23.0553 147.802 22.6126 148.121 22.0177C148.439 21.4228 148.598 20.6827 148.598 19.7903C148.598 18.898 148.446 18.1579 148.134 17.563C147.823 16.9681 147.415 16.5185 146.896 16.221C146.377 15.9167 145.824 15.7714 145.222 15.7714C144.62 15.7714 144.06 15.9236 143.548 16.221C143.029 16.5254 142.614 16.9681 142.296 17.563C141.978 18.1579 141.819 18.898 141.819 19.7903C141.819 20.6827 141.978 21.4228 142.296 22.0177C142.614 22.6126 143.023 23.0622 143.534 23.3597C144.032 23.664 144.586 23.8093 145.195 23.8093Z" fill="currentColor" />
      <path d="M158.275 25.9744C156.85 25.9744 155.723 25.5317 154.906 24.6394C154.09 23.747 153.682 22.4258 153.682 20.6688V13.8899H156.207V20.406C156.207 22.6887 157.141 23.83 159.015 23.83C159.949 23.83 160.717 23.498 161.326 22.834C161.927 22.1699 162.232 21.2153 162.232 19.9771V13.883H164.757V25.6908H162.522L162.336 23.6225C161.969 24.3488 161.436 24.9299 160.731 25.3449C160.011 25.7669 159.195 25.9744 158.275 25.9744Z" fill="currentColor" />
      <path d="M173.341 25.9744C172.2 25.9744 171.19 25.7046 170.318 25.1651C169.447 24.6255 168.762 23.8854 168.271 22.9515C167.779 22.0177 167.53 20.9525 167.53 19.7627C167.53 18.5729 167.779 17.5146 168.271 16.5876C168.762 15.6607 169.447 14.9275 170.325 14.4018C171.204 13.8692 172.213 13.6063 173.362 13.6063C174.296 13.6063 175.119 13.7861 175.824 14.1528C176.53 14.5194 177.083 15.0313 177.478 15.7022V8.5636H180.002V25.6908H177.74L177.478 23.8577C177.097 24.4111 176.571 24.9022 175.907 25.3311C175.243 25.76 174.385 25.9744 173.341 25.9744ZM173.791 23.7885C174.87 23.7885 175.755 23.415 176.44 22.6679C177.132 21.9209 177.478 20.9663 177.478 19.7903C177.478 18.6006 177.132 17.6391 176.44 16.8989C175.748 16.1588 174.863 15.7922 173.791 15.7922C172.712 15.7922 171.826 16.1588 171.127 16.8989C170.429 17.6391 170.083 18.6006 170.083 19.7903C170.083 20.5651 170.242 21.2568 170.56 21.8586C170.878 22.4604 171.314 22.9308 171.881 23.2767C172.435 23.6156 173.078 23.7885 173.791 23.7885Z" fill="currentColor" />
    </svg>
  );
}

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
              Define <Link href="/docs/core/schema-and-storage" className="sp-inline-link">collections</Link>,{" "}
              <Link href="/docs/core/schema-and-storage" className="sp-inline-link">SQL tables</Link>,{" "}
              <Link href="/docs/core/queries-and-access" className="sp-inline-link">access rules</Link>,{" "}
              <Link href="/docs/core/actions-jobs-routes" className="sp-inline-link">server actions, background jobs</Link>, and{" "}
              <Link href="/docs/core/pages-and-islands" className="sp-inline-link">React TSX pages</Link> in TypeScript. Headful WordPress by default — compiled into native PHP, SQL migrations, and standard plugins, with an optional{" "}
              <Link href="/docs/integrations/astro-and-clients" className="sp-inline-link">typed client and OpenAPI 3.1</Link> when you want headless.
            </p>
            <div className="sp-hero-ctas">
              <Link href="/quick-start" className="sp-btn sp-btn-primary sp-btn-lg">
                Start in 3 minutes →
              </Link>
              <Link href="/play" className="sp-btn sp-btn-secondary sp-btn-lg">
                Try in Browser
              </Link>
            </div>
            <div className="sp-install-box" data-tab-group="">
              <div className="sp-install-tabs" role="tablist" aria-label="Start method">
                <button type="button" role="tab" className="sp-install-tab is-active" data-tab-btn="agent" aria-selected="true">
                  Agent prompt
                </button>
                <button type="button" role="tab" className="sp-install-tab" data-tab-btn="cli" aria-selected="false">
                  CLI
                </button>
              </div>
              <div className="sp-cli-pill" data-tab-panel="agent">
                <span className="sp-agent-preview">
                  <code>Read https://spacepress.dev/start.md and https://spacepress.dev/rules.md, then build a SpacePress app…</code>
                </span>
                <button type="button" className="sp-copy-inline" data-copy={AGENT_PROMPT}>
                  Copy prompt
                </button>
              </div>
              <div className="sp-cli-pill" data-tab-panel="cli" hidden>
                <span>
                  <span className="sp-prompt">$ </span>
                  <code>npm create spacepress@0.3.0 my-app</code>
                </span>
                <button type="button" className="sp-copy-inline" data-copy="npm create spacepress@0.3.0 my-app">
                  Copy
                </button>
              </div>
              <p className="sp-install-note">
                Paste into Claude Code, Cursor, or Codex — reads <a href="/start.md" className="sp-inline-link">/start.md</a> &amp;{" "}
                <a href="/rules.md" className="sp-inline-link">/rules.md</a> and configures{" "}
                <Link href="/docs/operations/mcp-and-agents" className="sp-inline-link">MCP, 12 skills &amp; AGENTS.md</Link>.
              </p>
            </div>
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
          <p className="sp-sandbox-hint">
            Try editing line 30: change <code>&quot;Task not found&quot;</code> to <code>&quot;Word{"p"}ress task not found&quot;</code> for an inline <code>capital_P_dangit</code> warning + Auto-fix, or break <code>integer()</code> on line 26 to see inline compiler errors.
          </p>
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
              <small>spacepress build</small>
            </div>

            <div>
              <p className="sp-pipeline-label">Compiled output</p>
              <Tree text={GENERATED_TREE} />
            </div>
          </div>
          <p className="sp-sandbox-hint">
            <code>spacepress.dev</code> itself is compiled by SpacePress to native PHP on{" "}
            <Link href="/docs/operations/deploy-wp-cloud" className="sp-inline-link">Pressable</Link> — Reference docs, blog, SQL examples table, and playground share links included.{" "}
            <Link href="/docs/getting-started/project-structure" className="sp-inline-link">Project structure →</Link>{" · "}
            <Link href="/blog/introducing-spacepress" className="sp-inline-link">How it&apos;s built →</Link>
          </p>
        </div>
      </section>

      <section className="sp-section sp-section-subtle">
        <div className="sp-container">
          <div className="sp-section-head">
            <h2>Built on WordPress primitives</h2>
            <p>
              Keep Gutenberg, media, comments, <Link href="/docs/integrations/woocommerce" className="sp-inline-link">WooCommerce</Link>, and PHP hosting — authored with end-to-end TypeScript safety.
            </p>
          </div>

          <div className="sp-theses">
            <article className="sp-thesis">
              <span className="sp-mono-label">01</span>
              <h3>Headful WordPress by default, headless when you want it</h3>
              <p>
                File-based React TSX pages and layouts in{" "}
                <Link href="/docs/core/pages-and-islands" className="sp-inline-link"><code>sp/app/</code></Link> compile directly into server-rendered PHP inside WordPress, with{" "}
                <Link href="/docs/core/pages-and-islands" className="sp-inline-link"><code>&quot;use client&quot;</code> islands</Link> compiled to the WordPress Interactivity API. One server, one auth layer, native Gutenberg previews, and zero REST waterfalls — while every build still emits OpenAPI 3.1, a{" "}
                <Link href="/docs/integrations/astro-and-clients" className="sp-inline-link">typed client SDK, React hooks, and <code>@spacepress/astro</code></Link> whenever you want an external frontend.
              </p>
              <div className="sp-thesis-links">
                <Link href="/docs/core/pages-and-islands">Pages &amp; Islands →</Link>
                <Link href="/docs/integrations/astro-and-clients">Optional Headless &amp; Astro →</Link>
              </div>
            </article>

            <article className="sp-thesis">
              <span className="sp-mono-label">02</span>
              <h3>Zero Node.js in production — native PHP &amp; SQL</h3>
              <p>
                Mix editorial <Link href="/docs/core/schema-and-storage" className="sp-inline-link"><code>collection()</code></Link> posts and <code>wp.posts.extend()</code> (drafts, revisions, comments,{" "}
                <Link href="/docs/integrations/markdown-sync" className="sp-inline-link">two-way Markdown Git sync</Link>) with relational{" "}
                <Link href="/docs/core/schema-and-storage" className="sp-inline-link"><code>table()</code> SQL migrations</Link>, row- and field-level{" "}
                <Link href="/docs/core/queries-and-access" className="sp-inline-link"><code>.access()</code></Link>, typed{" "}
                <Link href="/docs/core/actions-jobs-routes" className="sp-inline-link"><code>action()</code> endpoints and Action Scheduler <code>job()</code> queues</Link>,{" "}
                <Link href="/docs/integrations/woocommerce" className="sp-inline-link">WooCommerce storefronts</Link>,{" "}
                <Link href="/docs/integrations/react-email" className="sp-inline-link">React Email templates</Link>, and{" "}
                <Link href="/handbook#admin-plugins" className="sp-inline-link"><code>/wp-admin/new/</code> screens</Link>.
              </p>
              <div className="sp-thesis-links">
                <Link href="/docs/core/schema-and-storage">Schema &amp; Storage →</Link>
                <Link href="/docs/integrations/woocommerce">WooCommerce →</Link>
                <Link href="/handbook">Handbook →</Link>
              </div>
            </article>

            <article className="sp-thesis">
              <span className="sp-mono-label">03</span>
              <h3>Safe for teams and coding agents</h3>
              <p>
                The <Link href="/handbook#compiler" className="sp-inline-link">Rust &amp; OXC compiler</Link> validates schemas, routes, hooks, and WordPress conventions like{" "}
                <Link href="/docs/reference/language-support" className="sp-inline-link"><code>capital_P_dangit</code></Link> before deploy. Expose actions as{" "}
                <Link href="/docs/operations/mcp-and-agents" className="sp-inline-link">WordPress Abilities</Link> with <code>readonly</code> and <code>destructive</code> annotations, run{" "}
                <Link href="/docs/operations/mcp-and-agents" className="sp-inline-link"><code>spacepress mcp</code></Link> for coding agents, and onboard agents directly from{" "}
                <a href="/llms.txt" className="sp-inline-link"><code>/llms.txt</code></a> and generated <code>AGENTS.md</code>.
              </p>
              <div className="sp-thesis-links">
                <Link href="/docs/operations/mcp-and-agents">MCP &amp; Abilities →</Link>
                <a href="/llms.txt">llms.txt →</a>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="sp-section">
        <div className="sp-container">
          <div className="sp-section-head">
            <h2>Change a schema, get an instant SQL migration</h2>
            <p>
              SpacePress reads <Link href="/docs/core/schema-and-storage" className="sp-inline-link">migration history</Link> from <code>sp/_generated/migrations/</code>. Try adding a field or renaming <code>title</code> with <code>.was(&quot;title&quot;)</code> below to generate a new migration folder.
            </p>
          </div>

          <Sandbox
            title="Live Schema Evolution -> Incremental SQL Migration"
            base={MIGRATION_BASE}
            defaultTab="migration.sql"
            diff
            presets={[
              {
                label: "Schema Diff",
                description: "The first migration creates `title` and `closed`. Edit the TypeScript to generate a new migration from that history.",
                output: "migration.sql",
                code: MIGRATION_NEXT,
              },
            ]}
          />
          <p className="sp-sandbox-hint">
            Migrating an existing schema? Convert statically without executing source code:{" "}
            <code>npx spacepress migrate config --from emdash|payload|sanity|zero &lt;input&gt; --out spacepress.config.ts</code>{" · "}
            <Link href="/docs/operations/cli-and-deploy" className="sp-inline-link">CLI Reference →</Link>
          </p>
        </div>
      </section>

      <section className="sp-section sp-section-subtle">
        <div className="sp-container">
          <div className="sp-section-head">
            <h2>Edit a complete app and boot it inside WordPress Playground</h2>
            <p>
              Every SpacePress build produces standard WordPress plugins. Click below to open the full multi-file <strong>Tasks</strong> app, edit its schema, page, or live{" "}
              <Link href="/docs/core/pages-and-islands" className="sp-inline-link"><code>&quot;use client&quot;</code> island</Link>, inspect every compiled artifact, and click <strong>Run in WordPress</strong> to launch it live in-tab — or browse all{" "}
              <Link href="/examples" className="sp-inline-link">examples</Link>.
            </p>
          </div>

          <sp-play
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
            <h2>Works on Spacefast, Pressable, WordPress.com — and everywhere else</h2>
            <p>
              Production output is standard PHP and WordPress plugins — zero Node.js server required. Push directly with{" "}
              <Link href="/docs/operations/cli-and-deploy" className="sp-inline-link"><code>spacepress push</code></Link> or upload the compiled plugins anywhere PHP 8.2+ and WordPress 7.1+ run.
            </p>
          </div>

          <div className="sp-deploy-grid">
            <Link className="sp-deploy-card" href="/docs/operations/deploy-spacefast">
              <div className="sp-deploy-card-head">
                <strong>Spacefast →</strong>
              </div>
              <span>Instant cloud deployment built for SpacePress apps and AI workflows.</span>
            </Link>

            <Link className="sp-deploy-card" href="/docs/operations/deploy-wp-cloud">
              <div className="sp-deploy-card-head">
                <strong>Pressable &amp; WordPress.com →</strong>
                <WpCloudLogo />
              </div>
              <span>Managed WordPress on WP Cloud — runs spacepress.dev itself. One guide covers both Pressable and plugin-enabled WordPress.com sites.</span>
            </Link>

            <Link className="sp-deploy-card" href="/docs/operations/deploy-self-hosted">
              <div className="sp-deploy-card-head">
                <strong>Everywhere else →</strong>
              </div>
              <span>Self-hosted WordPress, VPS, Docker, or any LAMP/LEMP host — see PHP 8.2+ &amp; WordPress 7.1+ requirements and standalone plugin setup.</span>
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

      <section className="sp-section" id="faq">
        <div className="sp-container">
          <div className="sp-section-head">
            <h2>Questions</h2>
          </div>

          <div className="sp-faq">
            <details className="sp-faq-item">
              <summary>Does SpacePress run Node.js in production?</summary>
              <p>
                No. Node.js 22+ is only used locally or in CI to invoke the prebuilt Rust compiler. Production output is native PHP (<code>schema.php</code>, <code>functions.php</code>), numbered SQL migrations, and standard WordPress plugins running on any{" "}
                <Link href="/docs/operations/deploy-self-hosted" className="sp-inline-link">WordPress 7.1+ / PHP 8.2+ host</Link>.
              </p>
            </details>
            <details className="sp-faq-item">
              <summary>Is SpacePress headless WordPress?</summary>
              <p>
                By default, no — SpacePress is headful WordPress. <Link href="/docs/core/pages-and-islands" className="sp-inline-link">Pages, layouts, and <code>&quot;use client&quot;</code> islands</Link> in <code>sp/app/</code> compile directly into server-rendered PHP inside WordPress, so routing, previews, auth, and plugins run in a single runtime. Headless is optional: every build also generates OpenAPI 3.1, a typed TypeScript client, React hooks, and{" "}
                <Link href="/docs/integrations/astro-and-clients" className="sp-inline-link"><code>@spacepress/astro</code></Link> whenever you want to drive an external frontend.
              </p>
            </details>
            <details className="sp-faq-item">
              <summary>Do existing WordPress plugins, WooCommerce, and Gutenberg still work?</summary>
              <p>
                Yes. <Link href="/docs/core/schema-and-storage" className="sp-inline-link">Collections</Link> compile to standard WordPress post types and <code>wp.posts.extend()</code> extends built-in posts, so Gutenberg, drafts, revisions, comments, and the media library work natively.{" "}
                <Link href="/docs/integrations/woocommerce" className="sp-inline-link">WooCommerce</Link> is modeled directly with <code>store()</code>, <code>product()</code>, and <code>order()</code>, and third-party plugins can be declared in <code>defineConfig(&#123; plugins &#125;)</code> and wired through <code>sp/wp-hooks/</code> or the{" "}
                <Link href="/docs/operations/mcp-and-agents" className="sp-inline-link">WordPress Abilities API</Link>.
              </p>
            </details>
            <details className="sp-faq-item">
              <summary>Can I inspect the generated PHP or eject later?</summary>
              <p>
                Yes. Every build writes readable PHP, SQL migrations, OpenAPI 3.1, and GPL-2.0-or-later plugins under <code>sp/</code> and <code>sp/dist/wp-content/plugins/</code>. Your data stays in standard WordPress posts and SQL tables — you can move hosts, edit the generated PHP directly, or stop using the compiler anytime. See{" "}
                <Link href="/docs/operations/cli-and-deploy" className="sp-inline-link">CLI &amp; Deployment</Link>.
              </p>
            </details>
            <details className="sp-faq-item">
              <summary>Why do the CLI, config file, and imports say <code>spacepress</code>?</summary>
              <p>
                SpacePress (<code>spacepress.dev</code>) is the framework brand; while{" "}
                <Link href="/changelog" className="sp-inline-link">v0 (&ldquo;Istanbul&rdquo;)</Link> prepares for 1.0, the npm package (<code>spacepress</code>), CLI binary, config file (<code>spacepress.config.ts</code>), <code>sp/</code> directory (customizable via <code>dir</code>), and imports (<code>&quot;spacepress&quot;</code>, <code>&quot;spacepress/server/*&quot;</code>) keep the pre-release identifier <code>spacepress</code>.
              </p>
            </details>
          </div>
        </div>
      </section>

      <section className="sp-section" style={{ paddingTop: 0 }}>
        <div className="sp-container">
          <div className="sp-cta-band">
            <h2>Ship your next WordPress app in TypeScript</h2>
            <p>
              Deploy to Spacefast, Pressable, WordPress.com, or self-hosted WordPress in minutes — no Docker or Rust toolchain required.
            </p>
            <div className="sp-hero-ctas" style={{ marginBottom: 0 }}>
              <Link href="/quick-start" className="sp-btn sp-btn-primary sp-btn-lg">
                Start the 3-Minute Quick Start →
              </Link>
              <Link href="/play" className="sp-btn sp-btn-secondary sp-btn-lg">
                Open Playground
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
