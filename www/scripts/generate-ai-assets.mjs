// Generates AI-friendly Markdown twins (/md/...), /start.md, /rules.md, /llms.txt,
// /llms-full.txt, /search-index.json, and /.well-known/{ai-catalog,agent-skills/index}.json
// inside www/public/ at build time.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..");
const out = join(site, "public");
const SITE_URL = "https://spacepress.dev";

function walkMd(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkMd(full, acc);
    else if (name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    meta[kv[1]] = val;
  }
  return { meta, body: m[2].trim() };
}

function formatMarkdownDoc(title, description, body, url) {
  const lines = [];
  if (!body.startsWith("# ")) {
    lines.push(`# ${title}`, "");
  }
  if (description) {
    lines.push(`> ${description}`, "");
  }
  lines.push(`Source: ${url}`, "", body, "");
  return lines.join("\n");
}

function writeOut(relPath, content) {
  const target = join(out, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

const HANDBOOK_SECTIONS = [
  { id: "mental-model", num: "01", title: "Project Layout & Mental Model", desc: "spacepress.config.ts, sp/ modules, and how the compiler emits native WordPress artifacts." },
  { id: "compiler", num: "02", title: "Rust & OXC Compiler", desc: "TypeScript/TSX parsing in Rust, emitted PHP/SQL/OpenAPI/types, and capital_P_dangit lint." },
  { id: "data-modeling", num: "03", title: "Data Modeling & Migrations", desc: "collection(), table(), global(), wp.posts.extend(), forward-only migration folders, and .was() safe renames." },
  { id: "queries-access", num: "04", title: "Queries, Validation & Access", desc: "Typed db queries, row-level filters, field-level .access(), and .validate()." },
  { id: "hooks", num: "05", title: "Hooks & Lifecycle Events", desc: "Transactional collection hooks (.on) and typed WordPress core hooks in sp/wp-hooks/." },
  { id: "actions-jobs-routes", num: "06", title: "Actions, Jobs, Routes & Files", desc: "Typed RPC action(), Action Scheduler job(), custom HTTP route.ts, and file buckets." },
  { id: "pages-islands", num: "07", title: "Pages, Layouts & Islands", desc: "File-based TSX pages in sp/app/ compiled to PHP and \"use client\" Interactivity API islands." },
  { id: "clients-astro", num: "08", title: "Typed Client, React & Astro", desc: "Generated fetch client, React hooks, and @spacepress/astro external frontend integration." },
  { id: "woocommerce", num: "09", title: "WooCommerce Storefront", desc: "store(), product(), shipping zones, orders, and optimistic cart hooks on native WooCommerce." },
  { id: "react-email", num: "10", title: "React Email Templates", desc: "Transactional email templates in emails/*.tsx rendered via mail.render() and mail.send()." },
  { id: "admin-plugins", num: "11", title: "Admin, Gutenberg & Plugins", desc: "spacepress-admin at /wp-admin/new/, adminScreen(), @spacepress/blocks, and plugins." },
  { id: "markdown-sync", num: "12", title: "Two-Way Markdown Git Sync", desc: "Three-way merges between content/**/*.md and WordPress Admin with stable UIDs." },
  { id: "mcp-agents", num: "13", title: "MCP, Abilities & AI Agents", desc: "WordPress Abilities API annotations and spacepress mcp server for coding agents." },
  { id: "deploy-cli", num: "14", title: "Hosting, Deploy & CLI", desc: "Deploy to Spacefast, Pressable, WordPress.com, or self-hosted WordPress with spacepress push." },
];

export function generateAiAssets() {
  const docsDir = join(site, "content", "docs");
  const postsDir = join(site, "content", "posts");

  const docEntries = [];
  for (const file of walkMd(docsDir).sort()) {
    const rel = relative(docsDir, file).replace(/\\/g, "/");
    const raw = readFileSync(file, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const isIndex = rel.endsWith("/index.md") || rel === "index.md";
    const docPath = isIndex
      ? rel.replace(/(^|\/)index\.md$/, "")
      : rel.replace(/\.md$/, "");
    const section = docPath.includes("/") ? docPath.split("/")[0] : "overview";
    const title = meta.title || docPath.split("/").pop() || "Reference";
    const description = meta.description || "";
    const order = Number(meta.order ?? 999);
    const pageUrl = `${SITE_URL}/docs/${docPath}`;
    const mdRel = `md/docs/${docPath}.md`;
    const mdText = formatMarkdownDoc(title, description, body, pageUrl);

    writeOut(mdRel, mdText);
    if (isIndex && docPath) {
      writeOut(`md/docs/${docPath}/index.md`, mdText);
    }

    docEntries.push({
      title,
      description,
      section,
      order,
      docPath,
      href: `/docs/${docPath}`,
      mdHref: `/${mdRel}`,
      mdText,
    });
  }

  docEntries.sort((a, b) => a.section.localeCompare(b.section) || a.order - b.order || a.title.localeCompare(b.title));

  const postEntries = [];
  for (const file of walkMd(postsDir).sort()) {
    const raw = readFileSync(file, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const slug = meta.slug || relative(postsDir, file).replace(/\.md$/, "");
    const title = meta.title || slug;
    const description = meta.excerpt || "";
    const pageUrl = `${SITE_URL}/blog/${slug}`;
    const mdRel = `md/blog/${slug}.md`;
    const mdText = formatMarkdownDoc(title, description, body, pageUrl);
    writeOut(mdRel, mdText);
    postEntries.push({
      title,
      description,
      slug,
      href: `/blog/${slug}`,
      mdHref: `/${mdRel}`,
      mdText,
    });
  }

  const quickStartMd = [
    "# SpacePress Quick Start",
    "",
    "> Go from zero to a running SpacePress application on local WordPress in 3 minutes — no Docker or Rust toolchain required.",
    "",
    `Source: ${SITE_URL}/quick-start/`,
    "",
    "## 1. Scaffold a new project",
    "",
    "```sh",
    "npm create spacepress@0.3.0 my-app",
    "cd my-app",
    "```",
    "",
    "## 2. Start local WordPress",
    "",
    "```sh",
    "npm run dev",
    "```",
    "",
    "## 3. Check & auto-fix",
    "",
    "```sh",
    "npx spacepress check",
    "npx spacepress check --fix",
    "```",
    "",
    "## 4. Sync Markdown content",
    "",
    "```sh",
    "npx spacepress sync",
    "```",
    "",
    "## 5. Build & deploy",
    "",
    "Deploy to Spacefast, Pressable, WordPress.com, or any self-hosted WordPress site:",
    "",
    "```sh",
    "npx spacepress build",
    "npx spacepress login https://example.com && npx spacepress push",
    "```",
    "",
  ].join("\n");
  writeOut("md/quick-start.md", quickStartMd);

  const handbookMd = [
    "# The SpacePress Handbook",
    "",
    "> End-to-end engineering handbook covering every layer of SpacePress — Rust/OXC compiler, schemas, SQL migrations, access control, actions, jobs, TSX pages, WooCommerce, React Email, Markdown sync, MCP, and deployment.",
    "",
    `Source: ${SITE_URL}/handbook/`,
    "",
    "## Chapters",
    "",
    ...HANDBOOK_SECTIONS.map((s) => `- **${s.num}. [${s.title}](${SITE_URL}/handbook/#${s.id})** — ${s.desc}`),
    "",
    "For complete topic-by-topic technical specs, fetch `/llms.txt` or `/llms-full.txt`.",
    "",
  ].join("\n");
  writeOut("md/handbook.md", handbookMd);

  const changelogMd = [
    "# SpacePress Changelog",
    "",
    "> Release notes and milestones for SpacePress, starting with v0 \"Istanbul\".",
    "",
    `Source: ${SITE_URL}/changelog/`,
    "",
    "## v0 \"Istanbul\" (CLI 0.3.0)",
    "",
    "- Headful WordPress by default (`sp/app/` TSX pages & `\"use client\"` Interactivity API islands compiled to native PHP), with optional headless via generated OpenAPI 3.1, typed client SDK, React hooks, and `@spacepress/astro`.",
    "- Rust + OXC compiler and WebAssembly browser playground (`/play/`).",
    "- `collection()`, `table()`, `global()`, `wp.posts.extend()`, incremental SQL migrations, row/field `.access()`, `action()`, Action Scheduler `job()`, WooCommerce storefronts, and React Email.",
    "- `spacepress check` & `spacepress check --fix` with `capital_P_dangit` lint and inline editor auto-fix.",
    "- Two-way Markdown & Git sync (`spacepress sync`).",
    "- Static schema migration (`spacepress migrate config --from emdash|payload|sanity|zero`).",
    "- WordPress Abilities API, `spacepress mcp`, `AGENTS.md`, and `/llms.txt`.",
    "",
  ].join("\n");
  writeOut("md/changelog.md", changelogMd);

  const startMd = [
    "# Build a SpacePress app",
    "",
    "You are helping someone build a TypeScript application that compiles directly into native PHP, SQL migrations, and WordPress plugins — headful WordPress by default, zero Node.js in production. Finish with a working local WordPress site they can open and inspect.",
    "",
    "## 1. Inspect the current directory",
    "",
    "Look at what is already in the workspace before scaffolding or asking questions. If the goal is still unclear, ask **one** concise question: *What are you building, and what should editors manage in WordPress?* Do not re-ask anything the user already told you.",
    "",
    "Choose the matching path:",
    "",
    "- **Already a SpacePress project (`spacepress.config.ts` exists):** Read `AGENTS.md` and use the `spacepress` MCP server (`schema`, `check`, `docs_search`, `docs_read`). Do not scaffold over it.",
    "- **Migrating an existing schema (EmDash, Payload, Sanity, or Zero):** Run `npx spacepress migrate config --from emdash|payload|sanity|zero <input> --out spacepress.config.ts` to convert statically without executing source code.",
    "- **Brand new project:** Scaffold with `npm create spacepress@0.3.0 <dir>` (uses the pre-release identifier `spacepress` for CLI, config file, and imports; requires Node.js 22+, no Docker or Rust toolchain). It writes `AGENTS.md`, `.mcp.json`, and 12 skills into `.agents/skills/` and `.claude/skills/`.",
    "- **Different existing app:** Ask before replacing its framework or files.",
    "",
    "## 2. Read the compiler rules first",
    "",
    `Read [${SITE_URL}/rules.md](${SITE_URL}/rules.md) before writing TypeScript so you follow the exact TS-to-PHP subset, import boundaries, access rules, and safe migration conventions on the first try.`,
    "",
    "## 3. Build one complete vertical slice",
    "",
    "1. **Model the data:** Use `collection()` (or `wp.posts.extend()`) for editorial content backed by WordPress posts (Gutenberg, drafts, revisions, `sync: \"content/**/*.md\"`), and `table()` for relational SQL data with explicit `access` rules.",
    "2. **Add server logic & pages:** Export `action()` RPC endpoints or `job()` queues from `sp/`, and build at least one headful server-rendered TSX page in `sp/app/` (plus a `\"use client\"` island if interactivity is needed). Only generate/wire an external frontend (`sp/_generated/client/` or `@spacepress/astro`) if the user explicitly wants headless.",
    "3. **Compile and check:** Run `npx spacepress check` after every edit (`npx spacepress check --fix` fixes lint warnings like `capital_P_dangit`), and `npx spacepress init` after changing `spacepress.config.ts` so `AGENTS.md` stays in sync.",
    "4. **Boot local WordPress and verify:** Run `npm run dev` (or `npx spacepress dev --detach`). Confirm the local site and `/wp-admin/new/` respond cleanly.",
    "5. **Hand back:** Share the local site URL, `/wp-admin/new/` admin URL, what is editable, and any remaining caveats. Do not create production credentials or push to a live site without explicit user approval.",
    "",
    "## 4. Reference & discovery",
    "",
    `- Compiler rules: ${SITE_URL}/rules.md`,
    `- Full documentation index: ${SITE_URL}/llms.txt`,
    `- Full documentation corpus: ${SITE_URL}/llms-full.txt`,
    `- Agent skills catalog: ${SITE_URL}/.well-known/agent-skills/index.json`,
    `- Local dev MCP server: \`npx --no-install spacepress mcp\` (read-only docs, live schema, check, and local queries; separate from a running site's authenticated runtime MCP at \`<site>/wp-json/mcp/spacepress-<app>\`).`,
    "",
  ].join("\n");
  writeOut("start.md", startMd);

  const rulesMd = [
    "# SpacePress Coding Agent Rules",
    "",
    "Targets SpacePress v0 (\"Istanbul\") / `spacepress` CLI `0.3.0` (WordPress 7.1+, PHP 8.2+).",
    "",
    "## Core compilation model",
    "",
    "- **Server TypeScript compiles to native PHP — not Node.js.** Never import Node built-ins (`fs`, `path`, `crypto`, `process`, `buffer`, `child_process`) or arbitrary npm packages inside `spacepress.config.ts`, `sp/app/`, actions, hooks, jobs, or routes.",
    "- **Headful WordPress is the default.** Files under `sp/app/**/page.tsx` and `layout.tsx` compile directly into server-rendered PHP inside WordPress. Interactive widgets belong in `\"use client\"` components compiled to the WordPress Interactivity API. Only wire `sp/_generated/client/` or `@spacepress/astro` when the user explicitly wants a separate headless frontend.",
    "- **Never edit `sp/_generated/` or `sp/dist/`.** `spacepress build` regenerates them. Commit `sp/_generated/` (migration folders, types, plugin lockfile). Ignore `sp/dist/` and `.sp/` in Git.",
    "- **Pre-release identifier:** The framework brand is SpacePress (`spacepress.dev`), while the npm package, CLI binary, config file (`spacepress.config.ts`), default `sp/` directory (customizable via `defineConfig({ dir })`), and imports (`\"spacepress\"`, `\"spacepress/server\"`, `\"spacepress/server/db\"`, `\"spacepress/server/app\"`, `\"spacepress/server/content\"`, `\"spacepress/server/wp\"`, `\"spacepress/client\"`, `\"spacepress/react\"`) use `spacepress` during v0.",
    "",
    "## Exact import boundaries",
    "",
    "- `\"spacepress\"`: schema, DSL & config builders (`collection`, `table`, `global`, `wp`, `taxonomy`, `store`, `product`, `productCategory`, `productTag`, `order`, `query`, `mutation`, `job`, `cron`, `env`, `defineConfig`, and field builders `text`, `integer`, `boolean`, `richText`, `slug`, `select`, `timestamp`, `ref`, `email`). Safe to import anywhere.",
    "- `\"spacepress/server\"`: server-only runtime APIs (`db`, `HttpError`, `once`, `mail`, `connectors`). Refused in `\"use client\"` components.",
    "- `\"spacepress/server/db\"`: visitor-scoped kind queries (e.g. `import { posts, tasks } from \"spacepress/server/db\"`). **Always prefer `\"spacepress/server/db\"` in `sp/app/` pages** because it enforces `.access()` rules automatically. Reserve trusted `db` from `\"spacepress/server\"` for `query()`/`mutation()`/`job()` handlers after verifying authorization.",
    "- `\"spacepress/server/app\"`: server page/layout helpers (`Link`, `Content`, `Html`, `Image`, `Live`, `useFormState`, `notFound`, `redirect`, `type PageProps`, `type LayoutProps`). Pages and layouts can also `import type { PageProps, LayoutProps, StaticParams } from \"./$types\"` via generated per-route types (`sp/_generated/types/`).",
    "- `\"spacepress/server/content\"`: navigation and OpenAPI helpers (`nav`, `pager`, `headings`, `apiReference`).",
    "- `\"spacepress/server/wp\"`: typed bridges to WordPress core functions, `Handler<\"...\">`, and `abilities.call(...)`.",
    "- `\"react\"`, `\"spacepress/react\"`, & `sp/_generated/api`: standard React hooks (`useState`, `useEffect`, `useRef`) from `\"react\"`, SpacePress hooks (`useLive`, `useMutation`, `useMount`, `useEvent`, `sharedState`, `uploadFile`) from `\"spacepress/react\"`, and typed `api` references from `../_generated/api` — valid inside `\"use client\"` components and external React apps.",
    "",
    "## Data modeling & migrations",
    "",
    "- Use `collection()` (or `wp.posts.extend()`) for editorial content that needs Gutenberg, drafts, revisions, comments, URL routing, or `sync: \"content/**/*.md\"`.",
    "- Use `table()` for relational application rows (tasks, votes, orders, subscriptions) stored in dedicated SQL tables with `.index([...])` and incremental migrations.",
    "- Export kinds, actions, and jobs from `spacepress.config.ts` or any file under `sp/` — they register automatically by export name; `defineConfig()` does not list them.",
    "- **Timestamp values:** Pass ISO-8601 strings (`new Date().toISOString()`) when writing `timestamp()` fields — not raw `Date` objects.",
    "- **Safe renames:** When renaming a field or column, chain `.was(\"oldName\")` so `spacepress build` emits a `RENAME` migration instead of dropping data.",
    "- **WooCommerce checkout:** Whenever a project exports `store()` alongside `sp/app/`, include a public `sp/app/checkout/page.md` containing WooCommerce's native Checkout Block (`<!-- wp:woocommerce/checkout -->`).",
    "- **Markdown sync:** Avoid raw HTML comments (`<!-- ... -->`) in synced `.md` files and never reuse a deleted document's `uid` for a new file.",
    "",
    "## Security & authorization",
    "",
    "- Declare explicit `access` rules on every `collection()`, `table()`, `global()`, and `action()`, and export `guard` on every custom `route.ts`.",
    "- For user-owned rows, return a row filter (`({ user }) => (user ? { ownerId: user.id } : false)`) rather than only checking truthiness; never trust a client-supplied `userId` in an action.",
    "- Attach field-level `.access({ read: \"admin\" })` to sensitive columns so REST, pages, and generated clients strip them automatically.",
    "- Annotate `action()` declarations with `readonly: true` or `destructive: true` to guide WordPress Abilities safety checks (`agents: false` opts internal actions out).",
    "",
    "## Verification workflow",
    "",
    "- Run `npx spacepress check` after every edit to `spacepress.config.ts` or `sp/` (`npx spacepress check --fix` applies auto-fixes such as `capital_P_dangit` for proper `WordPress` spelling).",
    "- Run `npx spacepress init` after config changes (`npx spacepress init --check` in CI).",
    "- Before deploying to production, always run `npx spacepress push --dry-run`, obtain explicit user approval, and verify afterward with `npx spacepress doctor --site <url> --links`.",
    "- On WP Cloud (Pressable / WordPress.com), avoid `/files/*` for custom public downloads and copy top-level `public/*.{js,wasm,txt}` files into `/srv/htdocs/` before purging edge cache.",
    "",
  ].join("\n");
  writeOut("rules.md", rulesMd);

  // Publish skills under /.well-known/agent-skills/ and catalog at /.well-known/ai-catalog.json
  const repoRoot = join(site, "..");
  const skillsDir = join(repoRoot, "skills");
  const skillEntries = [];
  if (existsSync(skillsDir)) {
    for (const name of readdirSync(skillsDir).sort()) {
      const skillFile = join(skillsDir, name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const raw = readFileSync(skillFile, "utf8");
      const { meta } = parseFrontmatter(raw);
      const digest = createHash("sha256").update(raw, "utf8").digest("hex");
      const relOut = `.well-known/agent-skills/${name}/SKILL.md`;
      writeOut(relOut, raw);
      skillEntries.push({
        name: meta.name || name,
        type: "skill-md",
        description: meta.description || "",
        url: `/${relOut}`,
        digest: `sha256:${digest}`,
      });
    }
  }
  writeOut(
    ".well-known/agent-skills/index.json",
    JSON.stringify(
      {
        $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
        skills: skillEntries,
      },
      null,
      2
    ) + "\n"
  );

  writeOut(
    ".well-known/ai-catalog.json",
    JSON.stringify(
      {
        specVersion: "0.9",
        host: {
          displayName: "SpacePress",
          identifier: "spacepress.dev",
          documentationUrl: `${SITE_URL}/docs/`,
        },
        entries: [
          {
            identifier: "urn:air:spacepress.dev:start:guide",
            displayName: "Build a SpacePress app",
            type: "text/markdown",
            url: `${SITE_URL}/start.md`,
            description: "Imperative playbook for an AI coding agent building a headful or optional-headless SpacePress app.",
            tags: ["spacepress", "spacepress", "wordpress", "typescript", "getting-started"],
          },
          {
            identifier: "urn:air:spacepress.dev:rules:guidelines",
            displayName: "SpacePress Coding Agent Rules",
            type: "text/markdown",
            url: `${SITE_URL}/rules.md`,
            description: "Concise TS-to-PHP compiler rules, import boundaries, access patterns, and migration conventions.",
            tags: ["spacepress", "rules", "compiler", "typescript", "php"],
          },
          {
            identifier: "urn:air:spacepress.dev:agent-skills:index",
            displayName: "SpacePress Agent Skills",
            type: "application/agent-skills+json",
            url: `${SITE_URL}/.well-known/agent-skills/index.json`,
            description: "All procedural agent skills bundled in the SpacePress CLI (schema, pages, actions, WooCommerce, Markdown sync, security audit, deployment, migrations).",
            tags: ["spacepress", "agent-skills", "wordpress", "mcp"],
          },
          {
            identifier: "urn:air:spacepress.dev:docs:llms-txt",
            displayName: "SpacePress docs index (llms.txt)",
            type: "text/plain",
            url: `${SITE_URL}/llms.txt`,
            description: "Plain-text index of every SpacePress documentation page and Markdown twin.",
            tags: ["spacepress", "documentation", "llms.txt"],
          },
        ],
      },
      null,
      2
    ) + "\n"
  );

  // Build /llms.txt (grouped cleanly per llms.txt convention)
  const grouped = new Map();
  for (const d of docEntries) {
    if (!grouped.has(d.section)) grouped.set(d.section, []);
    grouped.get(d.section).push(d);
  }

  const llmsLines = [
    "# SpacePress",
    "",
    "> SpacePress is a full-stack TypeScript framework whose Rust and OXC compiler compiles schemas, SQL tables, access rules, server actions, Action Scheduler jobs, and React TSX pages directly into native PHP, SQL migrations, OpenAPI 3.1, and standard WordPress plugins — zero Node.js in production.",
    "",
    `- Start here (agent build playbook): ${SITE_URL}/start.md`,
    `- Compiler rules & guardrails: ${SITE_URL}/rules.md`,
    `- Agent skills catalog: ${SITE_URL}/.well-known/agent-skills/index.json`,
    `- Full corpus: ${SITE_URL}/llms-full.txt`,
    `- Website: ${SITE_URL}`,
    "",
    "## Core Pages",
    "",
    `- [Quick Start](${SITE_URL}/md/quick-start.md): Go from zero to a running SpacePress app on local WordPress in 3 minutes.`,
    `- [The SpacePress Handbook](${SITE_URL}/md/handbook.md): Interactive 14-chapter engineering handbook with live WebAssembly compiler sandboxes.`,
    `- [Changelog](${SITE_URL}/md/changelog.md): Release notes for v0 "Istanbul" and SpacePress milestones.`,
    `- [Browser Playground](${SITE_URL}/play/): Edit TypeScript apps in the browser and boot them in WordPress Playground.`,
    `- [Examples](${SITE_URL}/examples/): Real compiled SpacePress applications.`,
    "",
  ];

  for (const [section, items] of grouped.entries()) {
    const label = section.charAt(0).toUpperCase() + section.slice(1);
    llmsLines.push(`## Reference: ${label}`, "");
    for (const d of items) {
      llmsLines.push(`- [${d.title}](${SITE_URL}${d.mdHref})${d.description ? `: ${d.description}` : ""}`);
    }
    llmsLines.push("");
  }

  if (postEntries.length > 0) {
    llmsLines.push("## Blog", "");
    for (const p of postEntries) {
      llmsLines.push(`- [${p.title}](${SITE_URL}${p.mdHref})${p.description ? `: ${p.description}` : ""}`);
    }
    llmsLines.push("");
  }

  writeOut("llms.txt", llmsLines.join("\n"));

  // Build /llms-full.txt
  const fullParts = [
    "# SpacePress — Full Documentation Corpus",
    "",
    `Index: ${SITE_URL}/llms.txt`,
    "",
    "---",
    "",
    startMd,
    "---",
    "",
    rulesMd,
    "---",
    "",
    quickStartMd,
    "---",
    "",
    handbookMd,
    ...docEntries.flatMap((d) => ["---", "", d.mdText]),
    ...postEntries.flatMap((p) => ["---", "", p.mdText]),
  ];
  writeOut("llms-full.txt", fullParts.join("\n"));

  // Build /search-index.json
  const searchIndex = [
    { title: "Quick Start", description: "Go from zero to a running SpacePress app in 3 minutes.", href: "/quick-start/", group: "Start" },
    { title: "The SpacePress Handbook", description: "Complete 14-chapter interactive engineering handbook.", href: "/handbook/", group: "Handbook" },
    { title: "Browser Playground", description: "Edit TypeScript apps, compile in WASM, and run in WordPress Playground.", href: "/play/", group: "Tools" },
    { title: "SpacePress Examples", description: "Real compiled SpacePress applications.", href: "/examples/", group: "Examples" },
    { title: "SpacePress Reference", description: "Browse all topic-by-topic technical reference pages.", href: "/docs/", group: "Reference" },
    { title: "SpacePress Blog", description: "Engineering notes and announcements.", href: "/blog/", group: "Blog" },
    { title: "Changelog (v0 Istanbul)", description: "Release notes and milestones for SpacePress.", href: "/changelog/", group: "Project" },
    { title: "Agent Start Playbook (start.md)", description: "Imperative step-by-step instructions for coding agents building a SpacePress app.", href: "/start.md", group: "AI Agents" },
    { title: "Coding Agent Rules (rules.md)", description: "TS-to-PHP compiler rules, import boundaries, access control, and safe migrations.", href: "/rules.md", group: "AI Agents" },
    ...HANDBOOK_SECTIONS.map((s) => ({
      title: `${s.num}. ${s.title}`,
      description: s.desc,
      href: `/handbook/#${s.id}`,
      group: "Handbook",
    })),
    ...docEntries.map((d) => ({
      title: d.title,
      description: d.description,
      href: `${d.href}/`,
      group: `Reference · ${d.section}`,
    })),
    ...postEntries.map((p) => ({
      title: p.title,
      description: p.description,
      href: `${p.href}/`,
      group: "Blog",
    })),
  ];
  writeOut("search-index.json", JSON.stringify(searchIndex));

  return { docs: docEntries.length, posts: postEntries.length, searchItems: searchIndex.length };
}
