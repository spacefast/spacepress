import { Code, ProjectExplorer, Sandbox, Tree } from "../Code";

const PROJECT_TREE = `my-app/
  spacepress.config.ts   Config entry & re-exports
  tsconfig.json          TypeScript paths ("spacepress", "spacepress/server/db")
  sp/
    schema.ts            Collections, SQL tables, globals, taxonomies
    server.ts            Actions, background jobs, helpers
    app/
      layout.tsx         Root layout & shared metadata
      page.tsx           Home page (/)
      not-found.tsx      Custom 404 page
      posts/[slug]/page.tsx  Dynamic item route
      api/feed.json/route.ts Custom HTTP route
    components/          Server & "use client" components
    wp-hooks/            Typed WordPress core actions & filters
    _generated/          Compiler-emitted db.d.ts, routes.d.ts, client/, migrations/
    dist/wp-content/     Built WordPress plugins (ready to deploy)
  content/               Markdown/JSON files synced with WordPress
  emails/                React Email templates rendered by mail.render()
  public/                Static assets served at site root`;

const COMPILER_SANDBOX = `import { collection, table, text, integer, slug, ref, action, defineConfig } from "spacepress";
import { db } from "spacepress/server";

export const guides = collection({
  title: text().min(1).max(120),
  slug: slug({ source: "title" }).optional(),
}, {
  label: "Guides",
  url: "/guides/:slug",
  access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
});

export const votes = table({
  guideId: ref(guides).onDelete("cascade"),
  score: integer().min(1).max(5),
}, {
  access: { read: "anyone", create: "anyone", update: "admin", delete: "admin" },
});

export const rateGuide = action({
  input: { guideId: integer(), score: integer().min(1).max(5) },
  access: "anyone",
  async handler({ guideId, score }) {
    const [row] = await db.insert(votes).values({ guideId, score }).returning();
    return row;
  },
});

export default defineConfig({ name: "guide-demo" });`;

const MIGRATION_BASE_GUIDE = `import { table, text, boolean, defineConfig } from "spacepress";

export const bookmarks = table({
  title: text().max(140),
  url: text().max(191),
  archived: boolean().default(false),
});

export default defineConfig({ name: "bookmarks" });`;

const MIGRATION_EVOLVED_GUIDE = `import { table, text, boolean, select, integer, timestamp, defineConfig } from "spacepress";

// Try renaming \`title\` -> \`label: text().max(140).was("title")\` or adding another column!
export const bookmarks = table({
  title: text().max(140),
  url: text().max(191).unique(),
  category: select(["docs", "article", "tool"]).default("article"),
  rating: integer().min(1).max(5).optional(),
  archived: boolean().default(false),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()),
}).index(["category", "archived"]);

export default defineConfig({ name: "bookmarks" });`;

const ACCESS_SANDBOX = `import {
  collection, table, userProjection, text, email, integer, select, ref, defineConfig,
} from "spacepress";

const STAFF = ["author", "editor", "admin"];

export const profiles = userProjection({
  email: email().unique().max(191),
  displayName: text().max(80),
  plan: select(["free", "pro"]).default("free"),
}, {
  access: { read: "self", create: "anyone", update: "self", delete: "admin" },
});

export const projects = collection({
  title: text().min(1).max(120),
  ownerId: integer(),
  // Field-level access: never exposed to non-staff readers
  budgetNotes: text({ multiline: true })
    .access({ read: "editor", create: "editor", update: "editor" })
    .optional(),
}, {
  label: "Projects",
  access: {
    read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" ? true : { ownerId: ctx.user?.id ?? -1 },
    delete: "editor",
  },
});

export const comments = table({
  projectId: ref(projects).onDelete("cascade"),
  body: text({ multiline: true })
    .min(2)
    .max(2000)
    .validate((v) => v.includes("http://") ? "Use https:// links only" : true),
}, {
  access: { read: "anyone", create: "authenticated", update: "editor", delete: "editor" },
});

export default defineConfig({ name: "access-guide" });`;

export function Part1Foundation() {
  return (
    <>
      <section id="mental-model" className="sp-guide-section">
        <span className="sp-guide-num">01</span>
        <h2>Project Layout &amp; Mental Model</h2>
        <p>
          A SpacePress application is a regular TypeScript repository whose single source of truth is <code>spacepress.config.ts</code> and the modules under <code>sp/</code>. Instead of running a separate Node.js backend beside WordPress, SpacePress compiles your TypeScript directly into native PHP, SQL migrations, TypeScript types, OpenAPI 3.1, and standard WordPress plugins.
        </p>
        <div className="sp-callout is-info">
          <strong>Pre-release package &amp; CLI naming:</strong> SpacePress is the framework and platform brand (<code>spacepress.dev</code>). While preparing its 1.0 release, the Rust CLI binary, npm package, config filename, and virtual imports remain spelled <code>spacepress</code> (<code>spacepress.config.ts</code>, <code>sp/</code>, <code>import ... from &quot;spacepress&quot;</code>, <code>spacepress/server/*</code>).
        </div>
        <Tree text={PROJECT_TREE} />
        <h3>Explore a complete multi-file SpacePress app</h3>
        <p>
          Click any file in the tree below to inspect how schema, server actions, layouts, dynamic routes, and interactive client islands fit together in a single project.
        </p>
        <ProjectExplorer project="editorial" open="sp/schema.ts" />
      </section>

      <section id="compiler" className="sp-guide-section">
        <span className="sp-guide-num">02</span>
        <h2>How the Rust &amp; OXC Compiler Works</h2>
        <p>
          SpacePress parses your TypeScript and TSX files with <strong>OXC</strong> in Rust. There is no Node.js runtime, V8 isolate, or JavaScript execution layer in production — every server artifact runs as plain, idiomatic PHP inside WordPress. During compilation, the OXC AST pass also runs non-fatal lint checks including <code>capital_P_dangit</code> (flagging a lowercase &ldquo;p&rdquo; in WordPress or SpacePress copy, auto-fixable via <code>spacepress check --fix</code> or in the live sandboxes below).
        </p>
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>What you author</th>
                <th>What the compiler emits</th>
                <th>Where it runs</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>collection()</code>, <code>table()</code>, <code>global()</code>, <code>taxonomy()</code>, <code>store()</code></td>
                <td><code>sp/app/schema.php</code> + numbered SQL migrations in <code>sp/_generated/migrations/</code></td>
                <td>WordPress PHP runtime &amp; MySQL/SQLite</td>
              </tr>
              <tr>
                <td><code>action()</code>, <code>job()</code>, <code>.on()</code> hooks, <code>.validate()</code>, access functions, <code>route.ts</code></td>
                <td><code>sp/app/functions.php</code></td>
                <td>Native PHP in WordPress / Action Scheduler</td>
              </tr>
              <tr>
                <td><code>sp/app/**/page.tsx</code> &amp; <code>layout.tsx</code></td>
                <td>Server-rendered PHP functions inside <code>functions.php</code></td>
                <td>Native PHP (or prebuilt HTML with <code>output: &quot;static&quot;</code>)</td>
              </tr>
              <tr>
                <td><code>&quot;use client&quot;</code> components</td>
                <td>Server-rendered PHP HTML + WordPress Interactivity API ES module</td>
                <td>PHP first paint + browser Interactivity API hydration</td>
              </tr>
              <tr>
                <td>Schema &amp; actions graph</td>
                <td><code>sp/_generated/db.d.ts</code>, <code>routes.d.ts</code>, <code>openapi.json</code>, <code>client/</code></td>
                <td>IDE type checking, external browsers, React &amp; Astro</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>Try the live compiler right here</h3>
        <p>
          Switch output tabs on the right to inspect every generated artifact from this single TypeScript file, or edit the code on the left to watch compilation happen in milliseconds inside WebAssembly.
        </p>
        <Sandbox
          eager
          title="Live Compiler: TypeScript -> PHP, SQL, Types & OpenAPI"
          defaultTab="schema.php"
          presets={[
            {
              label: "spacepress.config.ts",
              description: "Edit fields, bounds, or action logic — watch schema.php, functions.php, SQL migrations, db.d.ts, openapi.json, and client/types.ts update immediately.",
              code: COMPILER_SANDBOX,
            },
          ]}
        />
      </section>

      <section id="data-modeling" className="sp-guide-section">
        <span className="sp-guide-num">03</span>
        <h2>Data Modeling: Collections, Tables, Globals &amp; WordPress Kinds</h2>
        <p>
          SpacePress gives you six storage primitives — each chosen for a distinct job, all unified under one query and access API:
        </p>
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Builder</th>
                <th>Backing Storage</th>
                <th>Best For</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>collection(fields, opts)</code></td>
                <td>WordPress custom post type (<code>wp_posts</code> + meta)</td>
                <td>Editorial content needing Gutenberg, drafts, revisions, staged versions, comments, hierarchical paths, or Markdown sync</td>
              </tr>
              <tr>
                <td><code>table(fields, opts)</code></td>
                <td>Dedicated SQL table with automatic migrations</td>
                <td>Relational app data, high-volume records, logs, shares, votes, compound indexes (<code>.index([...])</code>)</td>
              </tr>
              <tr>
                <td><code>global(fields, opts)</code></td>
                <td>Singleton WordPress options record</td>
                <td>Site settings, navigation links, banner copy, feature flags (<code>db.globals.&lt;key&gt;</code>)</td>
              </tr>
              <tr>
                <td><code>wp.posts.extend()</code> / <code>.clone()</code></td>
                <td>WordPress built-in <code>post</code> type (or cloned CPT)</td>
                <td>Extending native WordPress blog posts with typed custom fields, URL pattern, and sync</td>
              </tr>
              <tr>
                <td><code>userProjection(fields, opts)</code></td>
                <td><code>wp_users</code> + <code>wp_usermeta</code></td>
                <td>Typed member profiles and account attributes without creating a duplicate user table</td>
              </tr>
              <tr>
                <td><code>taxonomy(fields, opts)</code></td>
                <td>WordPress taxonomy &amp; term tables</td>
                <td>Hierarchical or flat vocabularies attached to collections via <code>on: [posts]</code> or <code>terms(tax)</code></td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Field Builders &amp; Modifiers</h3>
        <p>
          Every field is <strong>required (NOT NULL) by default</strong> unless marked <code>.optional()</code>. Defaults (<code>.default()</code>, <code>.defaultNow()</code>, <code>.$default()</code>, <code>.$onUpdate()</code>) make fields omittable on insert.
        </p>
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Builders</th>
                <th>Key Modifiers</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Scalars</td>
                <td><code>text(&#123; multiline? &#125;)</code>, <code>integer()</code>, <code>number()</code>, <code>boolean()</code>, <code>date()</code>, <code>timestamp()</code>, <code>json&lt;T&gt;()</code></td>
                <td><code>.optional()</code>, <code>.default(v)</code>, <code>.defaultNow()</code>, <code>.$default(fn)</code>, <code>.$onUpdate(fn)</code>, <code>.unique()</code>, <code>.min(n)</code>, <code>.max(n)</code>, <code>.pattern(/re/)</code></td>
              </tr>
              <tr>
                <td>Semantic &amp; Editorial</td>
                <td><code>email()</code>, <code>url()</code>, <code>slug(&#123; source &#125;)</code>, <code>richText()</code>, <code>select([...])</code></td>
                <td><code>select([...]).many()</code> (JSON list filtered with <code>&#123; has: x &#125;</code>), <code>.validate((v, ctx) =&gt; ...)</code></td>
              </tr>
              <tr>
                <td>Media, Files &amp; Relations</td>
                <td><code>media(&#123; accept &#125;)</code>, <code>file(bucket)</code>, <code>ref(kind)</code>, <code>terms(tax)</code></td>
                <td><code>.many()</code>, <code>.onDelete(&quot;cascade&quot; | &quot;restrict&quot; | &quot;setNull&quot;)</code>, <code>.reverse(&quot;name&quot;)</code></td>
              </tr>
              <tr>
                <td>Structured &amp; Flexible</td>
                <td><code>group(fields)</code>, <code>repeater(fields)</code>, <code>blocks(layouts)</code></td>
                <td><code>.min(n)</code> / <code>.max(n)</code> item counts, <code>.ui(&#123; label, help, placeholder, width &#125;)</code>, <code>.showIf(&#123; ... &#125;)</code></td>
              </tr>
              <tr>
                <td>Migrations &amp; Renames</td>
                <td><code>field.was(&quot;oldName&quot;)</code>, <code>table(..., &#123; was: &quot;old_table&quot;, existingTable &#125;)</code></td>
                <td>Preserves existing rows and column values across deploys without data loss</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Interactive Schema Evolution &amp; SQL Migration Diff</h3>
        <p>
          The first migration creates a <code>bookmarks</code> table with three columns. Add a field or rename <code>title</code> using <code>.was(&quot;title&quot;)</code> below to see the SQL for the next migration.
        </p>
        <Sandbox
          title="Interactive Migration Generator (with Live Diff)"
          base={MIGRATION_BASE_GUIDE}
          defaultTab="migration.sql"
          diff
          presets={[
            {
              label: "Evolved Schema",
              description: "The first migration creates title, url, and archived. Toggle 'Diff' or edit a column to see the SQL statements.",
              output: "migration.sql",
              code: MIGRATION_EVOLVED_GUIDE,
            },
          ]}
        />
      </section>

      <section id="queries-access" className="sp-guide-section">
        <span className="sp-guide-num">04</span>
        <h2>Queries, Mutations, Validation &amp; Declarative Access Rules</h2>
        <p>
          SpacePress provides two database interfaces so authorization is always explicit:
        </p>
        <ul>
          <li>
            <strong>Visitor-scoped Kind API (<code>import &#123; posts &#125; from &quot;spacepress/server/db&quot;</code>):</strong> Every call (<code>list</code>, <code>paginate</code>, <code>get</code>, <code>count</code>, <code>create</code>, <code>update</code>, <code>delete</code>) enforces the current visitor&apos;s access rules, draft visibility, and field masks. Use <code>posts.system.*</code> only when intentionally escalating to trusted system access.
          </li>
          <li>
            <strong>Trusted Database API (<code>import &#123; db &#125; from &quot;spacepress/server&quot;</code>):</strong> Drizzle-inspired relational queries (<code>db.query.&lt;kind&gt;.findMany()</code>, <code>findFirst()</code>), writes (<code>db.insert()</code>, <code>db.update()</code>, <code>db.delete()</code> with <code>.returning()</code>), and <code>db.globals.&lt;key&gt;.get()</code> / <code>.update()</code>. Ideal inside hooks, background jobs, and already-authorized server actions.
          </li>
        </ul>

        <Code
          file="query-examples.ts"
          note="Visitor-scoped vs trusted queries"
          code={`import { db } from "spacepress/server";
import { posts } from "spacepress/server/db";

// Visitor-scoped: enforces read rules, draft visibility & field masks
const { rows, cursor } = await posts.paginate({
  where: { tags: { has: "release" } },
  orderBy: { publishedAt: "desc" },
  with: { authorId: true, cover: true },
  limit: 20,
});

// Trusted system query inside an action or background job
const draftCount = await db.query.posts.findMany({
  where: { OR: [{ status: "draft" }, { status: "scheduled" }] },
  columns: { id: true },
});`}
        />

        <h3>Role Ladder &amp; Declarative Access Control</h3>
        <p>
          Roles form an ordered ladder: <code>guest &lt; subscriber &lt; author &lt; editor &lt; admin</code>. Naming a role admits that role and every role above it. Shorthands also include <code>&quot;anyone&quot;</code>, <code>&quot;authenticated&quot;</code>, <code>&quot;self&quot;</code> (for user projections), or a boolean. For row-level authorization, pass a function returning either a boolean or a filter object — SpacePress compiles it to PHP and pushes row filters into SQL queries so unauthorized rows return 404.
        </p>

        <Sandbox
          title="Live Compiler: Row-Level Access, Field Masks & Custom Validation"
          defaultTab="functions.php"
          presets={[
            {
              label: "Access & Validation",
              description: "Edit the access rules or `.validate()` callback — inspect functions.php and schema.php to see the compiled PHP guards.",
              output: "functions.php",
              code: ACCESS_SANDBOX,
            },
          ]}
        />
      </section>
    </>
  );
}
