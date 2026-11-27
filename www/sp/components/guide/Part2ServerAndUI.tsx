import { Code, ProjectExplorer, Sandbox } from "../Code";

const HOOKS_SANDBOX = `import { table, job, defineConfig, f } from "spacepress";
import { db, HttpError } from "spacepress/server";

export const invoices = table({
  customer: f.text().max(120),
  cents: f.integer().min(1),
  code: f.text().max(40).optional(),
  syncedAt: f.timestamp().optional(),
}).on({
  beforeCreate(data) {
    data.customer = data.customer.trim();
    if (data.customer === "") {
      throw new HttpError(422, "invalid_input", "Customer name is required");
    }
    data.code = \`INV-\${crypto.randomUUID().slice(0, 8).toUpperCase()}\`;
  },
  async afterCreate(row) {
    await syncInvoice.enqueue({ invoiceId: row.id }, { key: \`inv-\${row.id}\` });
  },
});

export const syncInvoice = job({ retries: 3 }, async ({ invoiceId }: { invoiceId: number }) => {
  await db.update(invoices)
    .set({ syncedAt: new Date().toISOString() })
    .where({ id: invoiceId });
});

export default defineConfig({ name: "hooks-demo" });`;

const ACTIONS_FILES_SANDBOX = `import { table, files, mutation, job, env, defineConfig, f } from "spacepress";
import { db, HttpError } from "spacepress/server";

// Private file bucket: downloads use signed 5-minute URLs when loaded via \`with\`
export const briefs = files({
  accept: ["application/pdf"],
  maxBytes: 15_000_000,
  access: { read: "owner", create: "authenticated", delete: "editor" },
});

export const submissions = table({
  title: f.text().min(1).max(140),
  brief: f.file(briefs).optional(),
  status: f.text().default("pending"),
});

// Every query and mutation is also a typed WordPress Ability
export const approveSubmission = mutation({ access: "editor", idempotent: true }, async ({ id }: { id: number }) => {
  const [row] = await db.update(submissions)
    .set({ status: "approved" })
    .where({ id })
    .returning();
  if (!row) throw new HttpError(404, "not_found", "Submission not found");
  await notifyReviewer.enqueue({ id }, { delay: 10, key: \`approved-\${id}\` });
  return row;
});

// Jobs may read private files: briefs.readText(id), briefs.readBase64(id)
export const notifyReviewer = job({ retries: 2 }, async ({ id }: { id: number }) => {
  await db.query.submissions.findFirst({ where: { id } });
});

export default defineConfig({
  name: "workflow",
  uploads: { backend: "local" },
  webhooks: [
    {
      url: env("WORKFLOW_WEBHOOK_URL"),
      secret: env("WORKFLOW_WEBHOOK_SECRET"),
      events: ["submissions.created", "submissions.updated"],
    },
  ],
});`;

const WP_HOOK_CODE = `// sp/wp-hooks/the_content.ts
import type { Handler } from "spacepress/server/wp";

export const priority = 20;

const wrapContent: Handler<"the_content"> = (content) => {
  return \`<div class="prose-frame">\${content}</div>\`;
};

export default wrapContent;`;

const ROUTE_CODE = `// sp/app/api/feed.json/route.ts
import { type RouteRequest } from "spacepress";
import { db } from "spacepress/server";

export const access = "anyone";

export async function GET(req: RouteRequest) {
  const limit = Number(req.query.get("limit") ?? "10");
  const rows = await db.query.posts.findMany({
    where: { status: "published" },
    orderBy: { id: "desc" },
    limit: limit > 0 && limit <= 50 ? limit : 10,
  });
  return {
    headers: { "content-type": "application/feed+json" },
    body: JSON.stringify({
      version: "https://jsonfeed.org/version/1.1",
      title: "SpacePress Feed",
      items: rows.map((p) => ({ id: String(p.id), title: p.title })),
    }),
  };
}`;

const CLIENT_HOOKS_CODE = `import * as React from "react";
import { createClient } from "./sp/_generated/client/index";
import { createHooks } from "./sp/_generated/client/react";

export const client = createClient({ url: "https://cms.example.com" });
export const { useQuery, useMutation } = createHooks(React);

export function TaskCounter() {
  const { data, loading } = useQuery(client.tasks.list({ where: { done: false } }));
  const toggle = useMutation(
    (id: number) => client.actions.completeTask({ id }),
    {
      optimistic: (apply, id) => {
        apply(client.tasks.list({ where: { done: false } }), (rows) =>
          rows.filter((t) => t.id !== id),
        );
      },
    },
  );
  if (loading) return <p>Loading…</p>;
  return <p>{data?.length ?? 0} open tasks</p>;
}`;

const ASTRO_CODE = `// src/content.config.ts (Astro 7+)
import { defineCollection } from "astro:content";
import { spLoader, spLiveLoader } from "@spacepress/astro";

export const collections = {
  // Build-time static collection
  docs: defineCollection({
    loader: spLoader("docs", { where: { status: "published" } }),
  }),
  // Live on-demand collection with cacheHint.tags (<kind>, <kind>:<id>)
  posts: defineCollection({
    loader: spLiveLoader("posts", { rendered: "entries" }),
  }),
};

// src/pages/api/sp-webhook.ts — verifies SpacePress-Signature & invalidates tags
import { spWebhook } from "@spacepress/astro";
export const POST = spWebhook();`;

export function Part2ServerAndUI() {
  return (
    <>
      <section id="hooks" className="sp-guide-section">
        <span className="sp-guide-num">05</span>
        <h2>Hooks &amp; Lifecycle Events</h2>
        <p>
          Attach lifecycle hooks directly to any collection or SQL table with <code>.on(&#123; ... &#125;)</code>. Every hook compiles to native PHP and executes inside the write&apos;s transaction: throwing an <code>HttpError</code> (or any error) aborts the request and rolls back all changes cleanly.
        </p>
        <ul>
          <li><code>beforeCreate(data, ctx)</code> / <code>afterCreate(row, ctx)</code> — normalize input, enforce invariants, compute derived fields, or enqueue post-commit jobs.</li>
          <li><code>beforeUpdate(patch, existing, ctx)</code> / <code>afterUpdate(row, previous, ctx)</code> — react to field transitions with both old and new rows.</li>
          <li><code>beforeDelete(row, ctx)</code> / <code>afterDelete(row, ctx)</code> — run on permanent delete (trashing a WordPress post fires update hooks; emptying trash fires delete hooks).</li>
          <li><code>onPublish(row, ctx)</code> — fires whenever a collection item transitions to published (on create, update, or scheduled publish).</li>
        </ul>

        <Sandbox
          title="Live Compiler: Transactional Lifecycle Hooks"
          defaultTab="functions.php"
          presets={[
            {
              label: "Hooks & Rollback",
              description: "Edit the beforeCreate or afterCreate hook and see how SpacePress compiles them to PHP inside functions.php.",
              output: "functions.php",
              code: HOOKS_SANDBOX,
            },
          ]}
        />

        <h3>Typed WordPress Core Hooks (<code>sp/wp-hooks/</code>)</h3>
        <p>
          Need to tap directly into WordPress core filters or actions (<code>the_content</code>, <code>pre_get_posts</code>, <code>wp_head</code>, <code>wp_mail</code>, <code>save_post</code>, etc.)? Place a file in <code>sp/wp-hooks/&lt;hook&gt;.ts</code> using the typed <code>Handler&lt;&quot;...&quot;&gt;</code> helper from <code>&quot;spacepress/server/wp&quot;</code>.
        </p>
        <Code file="sp/wp-hooks/the_content.ts" note="Compiled to add_filter()" code={WP_HOOK_CODE} />
      </section>

      <section id="actions-jobs-routes" className="sp-guide-section">
        <span className="sp-guide-num">06</span>
        <h2>Queries, Mutations, Background Jobs, HTTP Routes &amp; Files</h2>
        <p>
          Beyond CRUD endpoints, SpacePress compiles three server primitives directly into WordPress:
        </p>
        <ul>
          <li>
            <strong>Server functions (<code>query()</code> &amp; <code>mutation()</code>):</strong> <code>query(options, handler)</code> only reads; <code>mutation(options, handler)</code> writes in one transaction. The input is the handler&apos;s parameter type, validated before the handler runs. Each one is mounted at <code>POST /wp-json/spacepress/v1/actions/&lt;name&gt;</code> and registered as a WordPress Ability, protected by <code>access</code> (default <code>&quot;editor&quot;</code>), rate limited with <code>rateLimit</code>, optionally signed via HMAC webhook verification (<code>signature</code>), and annotated <code>idempotent</code> or <code>destructive</code> for AI agents. Queries are marked read-only.
          </li>
          <li>
            <strong>Background Jobs (<code>job()</code>):</strong> <code>job(options, handler)</code>, queued with <code>myJob.enqueue(input, &#123; delay?, key? &#125;)</code> onto WordPress&apos;s <strong>Action Scheduler</strong>. Enqueueing inside a hook or mutation commits atomically with the database write, supports automatic <code>retries</code>, dedupe <code>key</code>s, and idempotency guards via <code>once(key, fn)</code>. Recurring work uses <code>job(&#123; every: &quot;1h&quot; &#125;, ...)</code> or <code>cron(&quot;0 3 * * *&quot;, ...)</code>. Jobs get longer outbound <code>fetch()</code> limits (60&nbsp;s, 16&nbsp;MiB) than requests do.
          </li>
          <li>
            <strong>Custom HTTP Routes (<code>sp/app/.../route.ts</code>):</strong> Export <code>GET</code>, <code>POST</code>, <code>PUT</code>, <code>PATCH</code>, or <code>DELETE</code> handlers plus <code>export const access</code> to serve JSON feeds, webhooks, robots.txt, or custom endpoints at any clean URL outside <code>/wp-json</code>.
          </li>
          <li>
            <strong>Private File Buckets (<code>files()</code>) &amp; Signed Webhooks:</strong> Store private uploads locally or on S3-compatible storage (<code>uploads: &#123; backend: &quot;s3&quot;, ... &#125;</code>) with automatic 5-minute signed download URLs, read them on the server with <code>bucket.get(id)</code>, <code>readText(id)</code> and <code>readBase64(id)</code>, accept uploads from islands with <code>uploadFile(bucket, file)</code>, and emit signed <code>SpacePress-Signature</code> HMAC webhooks on any <code>&lt;kind&gt;.created|updated|deleted</code> event.
          </li>
        </ul>

        <Sandbox
          title="Live Compiler: Private File Buckets, Mutations, Jobs & Webhooks"
          defaultTab="openapi.json"
          presets={[
            {
              label: "Mutations, Jobs & Files",
              description: "Inspect the generated openapi.json, schema.php, and functions.php for private buckets, signed webhooks, mutations, and delayed jobs.",
              output: "openapi.json",
              code: ACTIONS_FILES_SANDBOX,
            },
          ]}
        />

        <Code file="sp/app/api/feed.json/route.ts" note="Custom HTTP endpoint" code={ROUTE_CODE} />
      </section>

      <section id="pages-islands" className="sp-guide-section">
        <span className="sp-guide-num">07</span>
        <h2>Pages, Layouts, Server Components &amp; &quot;use client&quot; Islands</h2>
        <p>
          Drop TSX files into <code>sp/app/</code> to build full server-rendered websites and apps without leaving TypeScript. SpacePress compiles every page and layout into PHP that executes directly inside WordPress.
        </p>
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Convention / Export</th>
                <th>Behavior</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>sp/app/page.tsx</code>, <code>[slug]/page.tsx</code>, <code>[...path]/page.tsx</code>, <code>(group)/</code></td>
                <td>File-based routing. When a folder matches a collection&apos;s <code>url</code> pattern (e.g. <code>/blog/:slug</code>), SpacePress injects the fetched <code>item</code> automatically and returns 404 for drafts/missing slugs.</td>
              </tr>
              <tr>
                <td><code>layout.tsx</code>, <code>not-found.tsx</code>, <code>login.tsx</code></td>
                <td>Nested shared layouts, custom 404 view, and custom <code>wp-login.php</code> screen with <code>&lt;LoginForm /&gt;</code>.</td>
              </tr>
              <tr>
                <td><code>export const metadata</code> / function</td>
                <td>Title templates (<code>&#123; default, template &#125;</code>), description, canonical, robots, Open Graph, Twitter cards, custom <code>&lt;link&gt;</code> tags, and <code>scripts</code> from <code>public/</code>.</td>
              </tr>
              <tr>
                <td><code>export const template</code></td>
                <td><code>&quot;theme&quot;</code> (wraps page in active block theme header/footer), <code>&quot;blank&quot;</code> (layout draws its own shell), or any block template slug.</td>
              </tr>
              <tr>
                <td><code>export const search</code> &amp; <code>guard</code></td>
                <td>Typed query-string parsing (e.g. <code>&#123; page: f.integer().default(1) &#125;</code>) and route-level access guards.</td>
              </tr>
              <tr>
                <td><code>output: &quot;static&quot;</code> + <code>staticParams()</code></td>
                <td>Prebuilds pages into standalone HTML via <code>spacepress export</code> — no WordPress server needed at serve time.</td>
              </tr>
              <tr>
                <td>Built-in UI primitives (<code>spacepress/app</code>)</td>
                <td><code>&lt;Link&gt;</code> (client-side router navigation), <code>&lt;Content&gt;</code>, <code>&lt;Html&gt;</code>, <code>&lt;Comments&gt;</code>, <code>&lt;Pagination&gt;</code>, <code>&lt;Search&gt;</code>, <code>&lt;SearchResults&gt;</code>, <code>&lt;TemplatePart&gt;</code>, <code>&lt;Live&gt;</code>, <code>useFormState()</code>.</td>
              </tr>
              <tr>
                <td><code>&quot;use client&quot;</code> (<code>react</code> + <code>spacepress/react</code> + <code>_generated/api</code>)</td>
                <td>Compiles server HTML + a WordPress Interactivity API module supporting <code>useState</code>, <code>useEffect</code>, <code>useMount</code>, <code>useEvent</code>, <code>useRef</code>, <code>sharedState</code>, and real-time <code>useLive()</code> subscriptions.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          CSS imports (<code>import &quot;./site.css&quot;</code>) and CSS Modules (<code>import styles from &quot;./card.module.css&quot;</code>) are content-hashed and copied automatically into the built app plugin. Inspect the layout, page, and <code>&quot;use client&quot;</code> island from our editorial example:
        </p>
        <ProjectExplorer project="editorial" open="sp/components/ClapButton.tsx" />
      </section>

      <section id="clients-astro" className="sp-guide-section">
        <span className="sp-guide-num">08</span>
        <h2>Generated Typed Client, React Hooks &amp; Astro Integration</h2>
        <p>
          Want to pair a SpacePress backend with a React SPA, Next.js, TanStack Start, Vite, or Astro frontend? Every build writes a zero-dependency typed client into <code>sp/_generated/client/</code> alongside framework-agnostic React hooks (<code>react.ts</code>) that accept your own React 18+ or Preact instance via <code>createHooks(React)</code>.
        </p>
        <Code file="src/components/TaskCounter.tsx" note="Live queries + optimistic mutations" code={CLIENT_HOOKS_CODE} />
        <h3>First-Class Astro Integration (<code>@spacepress/astro</code>)</h3>
        <p>
          Use <code>@spacepress/astro</code> to connect any SpacePress backend to Astro&apos;s Content Layer with build-time (<code>spLoader</code>) or on-demand live collections (<code>spLiveLoader</code>), automatic cache tags, signed webhook invalidation (<code>spWebhook</code>), and <code>frontend: &quot;https://...&quot;</code> in <code>defineConfig()</code> so WordPress permalinks and previews point to your external frontend.
        </p>
        <Code file="src/content.config.ts" note="@spacepress/astro" code={ASTRO_CODE} />
      </section>
    </>
  );
}
