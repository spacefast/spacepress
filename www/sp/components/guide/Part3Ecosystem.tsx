import { Cmd, Code, Sandbox } from "../Code";

const WOO_GUIDE_SANDBOX = `import {
  store, product, productCategory, productTag, order, defineConfig,
} from "spacepress";

export const shop = store({
  currency: "EUR",
  country: "DE",
  address: { line1: "Torstrasse 1", city: "Berlin", postcode: "10119" },
  sellTo: ["DE", "PL", "NL", "FR"],
  units: { weight: "kg", dimension: "cm" },
  shipping: [
    {
      name: "EU Standard",
      countries: ["DE", "PL", "NL", "FR"],
      methods: [
        { type: "flatRate", title: "Tracked Courier", cost: "12.00" },
        { type: "freeShipping", title: "Free over 150 EUR", minimum: "150.00" },
      ],
    },
  ],
  payments: ["cod"],
  email: { fromName: "SpacePress Store", fromAddress: "store@example.com" },
});

export const products = product({ sync: "content/products/*.md", url: "/products/:slug" });
export const categories = productCategory({ sync: "content/product-categories/*.md", url: "/shop/:path" });
export const tags = productTag();
export const orders = order();

export default defineConfig({ name: "eu-shop" });`;

const WOO_CART_HOOKS = `import * as React from "react";
import { createCartHooks } from "./sp/_generated/client/cart-react";

export const { useCart, useCartCount } = createCartHooks(React);

export function CartBadge() {
  const count = useCartCount();
  return <a href="/cart">Cart ({count ?? 0})</a>;
}`;

const REACT_EMAIL_CODE = `// emails/invitation.tsx
import { Body, Button, Html, Text } from "react-email";

export interface InvitationProps {
  name: string;
  url: string;
}

export default function Invitation({ name, url }: InvitationProps) {
  return (
    <Html lang="en">
      <Body>
        <Text>Hello, {name}!</Text>
        <Button href={url}>Accept invitation</Button>
      </Body>
    </Html>
  );
}

// sp/server.ts — transactional send queued in-transaction & retried after commit
import { mutation } from "spacepress";
import { mail } from "spacepress/server";
import Invitation from "../emails/invitation";

export const inviteMember = mutation({ access: "admin" }, async ({ to, name }: { to: string; name: string }) => {
  const rendered = mail.render(Invitation, {
    name,
    url: "https://example.com/accept",
  });
  return await mail.send({
    to,
    subject: \`You're invited, \${name}\`,
    html: rendered.html,
    text: rendered.text,
  });
});`;

const ADMIN_SCREEN_SANDBOX = `import { table, text, integer, query, mutation, adminScreen, item, defineConfig } from "spacepress";
import { db, HttpError } from "spacepress/server";

export const tickets = table({
  subject: text().max(160),
  priority: integer().default(2),
  state: text().default("open"),
});

export const listOpenTickets = query({ access: "editor" }, async () =>
  await db.query.tickets.findMany({ where: { state: "open" }, orderBy: { priority: "asc" } }));

export const closeTicket = mutation({ access: "editor", destructive: true }, async ({ id }: { id: number }) => {
  const [row] = await db.update(tickets).set({ state: "closed" }).where({ id }).returning();
  if (!row) throw new HttpError(404, "not_found", "Ticket not found");
  return row;
});

// Renders in both /wp-admin/new/screens/open-tickets and classic wp-admin
export const openTickets = adminScreen({
  title: "Open Tickets",
  description: "Triage and resolve incoming support tickets.",
  access: "editor",
  view: {
    action: listOpenTickets,
    fields: {
      subject: { label: "Subject", type: "text" },
      priority: { label: "Priority", type: "integer" },
      state: { label: "State", type: "text" },
    },
    layout: { type: "table", titleField: "subject", fields: ["subject", "priority", "state"] },
  },
  actions: [
    {
      id: "close",
      label: "Close ticket",
      action: closeTicket,
      input: { id: item("id") },
      confirm: "Mark this ticket as closed?",
    },
  ],
});

export default defineConfig({ name: "support-desk" });`;

const SYNC_MD_EXAMPLE = `---
uid: zr_8f31c902a1d44b8e72a1
title: Getting Started with SpacePress
description: Install the CLI and launch your first local WordPress site.
order: 1
status: published
publishedAt: 2026-11-21T09:00:00.000Z
---
Write documentation or blog posts in plain Markdown. Front matter keys are validated
against your TypeScript schema at sync time — typos fail with the exact file and line.`;

const ABILITIES_CODE = `import { query } from "spacepress";
import { abilities } from "spacepress/server/wp";

// Call any registered WordPress Ability with compiled input/output types
export const runSiteCheck = query({ access: "admin" }, async () =>
  await abilities.call("core/get-site-info", {}));`;

export function Part3Ecosystem() {
  return (
    <>
      <section id="woocommerce" className="sp-guide-section">
        <span className="sp-guide-num">09</span>
        <h2>WooCommerce Native Storefront</h2>
        <p>
          SpacePress treats WooCommerce as a first-class typed runtime rather than an afterthought. Declare <code>store()</code>, <code>product()</code>, <code>productCategory()</code>, <code>productTag()</code>, and <code>order()</code> in TypeScript — or scaffold a complete storefront into any project with <code>spacepress add shop</code>.
        </p>
        <ul>
          <li><strong>Declarative Store Settings:</strong> Currency, store country &amp; address, selling regions, weight/dimension units, shipping zones &amp; methods (<code>flatRate</code>, <code>freeShipping</code>, <code>localPickup</code>), payment gateways, and store email sender.</li>
          <li><strong>Synced Catalogs:</strong> Products, categories, and tags support <code>sync: &quot;content/products/*.md&quot;</code> and clean URL patterns like <code>/products/:slug</code>.</li>
          <li><strong>Optimistic Cart Client &amp; React Hooks:</strong> Whenever a project exports a <code>store()</code>, <code>spacepress build</code> automatically emits <code>commerce.ts</code>, <code>cart-store.ts</code>, and <code>cart-react.ts</code> into <code>sp/_generated/client/</code> with optimistic quantity updates and rollback.</li>
        </ul>

        <Sandbox
          title="Live Compiler: Native WooCommerce Store & Catalog"
          defaultTab="schema.php"
          presets={[
            {
              label: "WooCommerce Store",
              description: "Edit shipping zones, currency, or catalog routes and inspect the compiled WooCommerce schema & client types.",
              output: "schema.php",
              code: WOO_GUIDE_SANDBOX,
            },
          ]}
        />

        <Code file="src/components/CartBadge.tsx" note="Optimistic WooCommerce cart hooks" code={WOO_CART_HOOKS} />
      </section>

      <section id="react-email" className="sp-guide-section">
        <span className="sp-guide-num">10</span>
        <h2>React Email Templates &amp; Transactional Mail</h2>
        <p>
          Author transactional emails as React components under <code>emails/*.tsx</code> using <code>react-email</code>. Inside hooks, mutations, routes, or background jobs, render them to both HTML and plain text with <code>mail.render(Template, props)</code> and queue delivery with <code>mail.send()</code>.
        </p>
        <p>
          Every <code>mail.send()</code> call participates in the handler&apos;s database transaction: the message is handed off to the site&apos;s mail transport only after commit (with automatic retries on failure), and a rollback sends nothing.
        </p>
        <Code file="emails/invitation.tsx + sp/server.ts" note="Transactional React Email" code={REACT_EMAIL_CODE} />
      </section>

      <section id="admin-plugins" className="sp-guide-section">
        <span className="sp-guide-num">11</span>
        <h2>WordPress Admin, Gutenberg, Custom Screens &amp; Plugins</h2>
        <p>
          Every SpacePress build ships <strong>SpacePress Admin</strong> (<code>spacepress-admin</code>) at <code>/wp-admin/new/</code> alongside classic <code>wp-admin</code> (opt out with <code>admin: false</code>). Collections automatically get Gutenberg editing, drafts, revisions, and <strong>staged versions</strong> (save a parallel staged edit, compare, promote, or discard via CLI or Admin).
        </p>
        <ul>
          <li>
            <strong>Custom Admin Screens (<code>adminScreen()</code>):</strong> Build rich DataViews tables/grids or DataForms backed by your <code>query()</code> and <code>mutation()</code> functions. One declarative definition renders in both <code>/wp-admin/new/screens/&lt;slug&gt;</code> and classic <code>wp-admin</code>.
          </li>
          <li>
            <strong>Gutenberg Blocks &amp; Block Themes in TSX (<code>@spacepress/blocks</code>):</strong> Author real Gutenberg post content and complete block themes in TSX — HTML tags map to core blocks (<code>&lt;p&gt;</code> → <code>core/paragraph</code>) while <code>blockComponent()</code> and <code>&lt;Block name=&quot;...&quot; /&gt;</code> target any registered block.
          </li>
          <li>
            <strong>Locked WordPress Plugins &amp; Sealed Mode:</strong> Declare WordPress.org or URL plugins in <code>defineConfig(&#123; plugins: &#123; ... &#125;, sealed: true &#125;)</code> with exact versions and SHA-256 checksums locked in <code>sp/_generated/wp-plugins.lock.json</code>. In <code>sealed: true</code> mode, activating any undeclared plugin is refused.
          </li>
          <li>
            <strong>TypeScript Plugin Packages (<code>definePlugin()</code> + <code>use</code>):</strong> Compose reusable SpacePress packages with <code>use: [myPlugin(...)]</code>. Installed packages can ship TSX components, <code>&quot;use client&quot;</code> islands and stylesheets, as <code>@spacepress/docs</code> and <code>@spacepress/todo</code> do. The compiler infers exact capabilities from compiled code and locks grants, including a hash of each package island, in <code>sp/_generated/plugins.lock.json</code>.
          </li>
        </ul>

        <Sandbox
          title="Live Compiler: Declarative adminScreen() DataView"
          defaultTab="schema.php"
          presets={[
            {
              label: "Support Queue Screen",
              description: "Edit columns, confirm prompt, or layout type (`table`, `grid`, `list`) and see the compiled screen & Ability bindings.",
              output: "schema.php",
              code: ADMIN_SCREEN_SANDBOX,
            },
          ]}
        />
      </section>

      <section id="markdown-sync" className="sp-guide-section">
        <span className="sp-guide-num">12</span>
        <h2>Two-Way Markdown &amp; Git Sync</h2>
        <p>
          Add <code>sync: &quot;content/docs/**/*.md&quot;</code> (hierarchical folder tree) or <code>sync: &quot;content/posts/*.md&quot;</code> (flat folder) to any collection or taxonomy. SpacePress assigns each record a permanent <code>uid</code> and keeps your repository and WordPress database synchronized in both directions.
        </p>
        <Code file="content/docs/getting-started.md" lang="markdown" note="Schema-validated front matter" code={SYNC_MD_EXAMPLE} />
        <Cmd command="npx spacepress sync" />
        <ul>
          <li><strong>3-way merge &amp; conflict detection:</strong> Tracks the last synced base state so non-overlapping edits in Git and WordPress merge cleanly, while true conflicts are flagged explicitly.</li>
          <li><strong>GitHub workflow automation:</strong> Run <code>spacepress init --github</code> to scaffold automated sync workflows and configure <code>spacepress git-dispatch</code> so saves in WordPress Admin notify your repository automatically.</li>
          <li><strong>Standalone seeding:</strong> Enable <code>seed: true</code> in <code>defineConfig()</code> so fresh deployments seed synced content on plugin activation without overwriting existing editorial changes.</li>
        </ul>
      </section>

      <section id="mcp-agents" className="sp-guide-section">
        <span className="sp-guide-num">13</span>
        <h2>MCP, WordPress Abilities &amp; AI Agents</h2>
        <p>
          SpacePress is built from day one for coding agents and runtime AI workflows:
        </p>
        <ul>
          <li>
            <strong>Project MCP Server (<code>spacepress mcp</code>):</strong> Serves your project&apos;s schema, routes, diagnostics, and embedded version-matched documentation over stdio MCP. Run <code>spacepress init</code> to generate <code>AGENTS.md</code>, <code>.mcp.json</code>, and agent skills automatically.
          </li>
          <li>
            <strong>WordPress Abilities API:</strong> Collections, globals, queries, mutations, and jobs are exposed as WordPress Abilities by default (<code>agents: false</code> opts out), and the generated typed client calls them through core&apos;s <code>/wp-json/wp-abilities/v1/abilities/&lt;app&gt;/&lt;name&gt;/run</code> route. Queries are marked read-only; mark mutations <code>destructive: true</code> so AI agents know when to ask for confirmation. Call any installed site ability with full type safety via <code>abilities.call()</code> after running <code>spacepress abilities pull --site &lt;url&gt;</code>.
          </li>
          <li>
            <strong>Runtime Schema Versions (<code>runtimeSchema: true</code>):</strong> Allow live sites to evolve collections and fields as numbered schema versions, then pull them back into source control with <code>spacepress pull</code>.
          </li>
        </ul>
        <Code file="sp/server.ts" note="Typed WordPress Abilities" code={ABILITIES_CODE} />
      </section>

      <section id="deploy-cli" className="sp-guide-section">
        <span className="sp-guide-num">14</span>
        <h2>Hosting, Deployment, Packaging &amp; CLI Reference</h2>
        <p>
          Because SpacePress compiles down to standard PHP and WordPress plugins, you can deploy anywhere WordPress runs — <strong>Spacefast</strong>, <strong>Pressable</strong>, <strong>WordPress.com</strong>, <strong>self-hosted WordPress</strong> (VPS/Docker/LAMP), or static CDN hosting (with <code>output: &quot;static&quot;</code>).
        </p>

        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Command</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>spacepress dev</code> / <code>dev stop</code> / <code>dev status</code></td>
                <td>Start, stop, or inspect the local WordPress + SQLite dev server with automatic rebuilds on file change.</td>
              </tr>
              <tr>
                <td><code>spacepress check</code></td>
                <td>Type-check and validate schemas, hooks, server functions, pages, and migrations without writing output (supports <code>--json</code> and <code>--frozen</code> for CI).</td>
              </tr>
              <tr>
                <td><code>spacepress build</code></td>
                <td>Emit WordPress plugins into <code>sp/dist/wp-content/plugins/</code>, SQL migrations, <code>db.d.ts</code>, <code>openapi.json</code>, and typed client.</td>
              </tr>
              <tr>
                <td><code>spacepress export</code></td>
                <td>Export <code>sp/app/</code> as a standalone static HTML site to <code>sp/dist/static/</code> (when <code>output: &quot;static&quot;</code>).</td>
              </tr>
              <tr>
                <td><code>spacepress sync</code></td>
                <td>Two-way sync between local Markdown/JSON content files and the WordPress database.</td>
              </tr>
              <tr>
                <td><code>spacepress add &lt;shop|db|api-reference&gt;</code></td>
                <td>Add starter modules into your project as source files you own (never overwrites existing files).</td>
              </tr>
              <tr>
                <td><code>spacepress plugin</code></td>
                <td>Write uploadable <code>spacepress.zip</code> for manual activation inside <code>wp-admin</code>.</td>
              </tr>
              <tr>
                <td><code>spacepress login &lt;url&gt;</code> &amp; <code>spacepress push</code></td>
                <td>Authenticate via WordPress Application Passwords and deploy your compiled app, plugins, and migrations directly to a live site.</td>
              </tr>
              <tr>
                <td><code>spacepress doctor</code></td>
                <td>Verify build integrity, plugin versions, live site state, and (with <code>--links</code>) crawl every internal link and anchor.</td>
              </tr>
              <tr>
                <td><code>spacepress wp ...</code>, <code>migrate</code>, <code>jobs</code>, <code>staged</code>, <code>identity</code></td>
                <td>Direct site operations via WP-CLI against local dev or remote <code>--site</code> targets.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Boot a full multi-file SpacePress app in WordPress Playground</h3>
        <p>
          Try editing <strong>Field Notes</strong> (<code>full-site</code>) below — it combines collections, field-level access rules, a SQL applause table, a mutation, dynamic TSX routes, a custom JSON Feed route, and a <code>&quot;use client&quot;</code> island. Compile it live and click <strong>Run in WordPress</strong> to test it in-tab.
        </p>
        <sp-play
          example="full-site"
          hint="Full editorial site: collections, SQL table, mutation, TSX pages, JSON Feed route, and Interactivity API island — compile & launch in WordPress."
        />
      </section>
    </>
  );
}
