// Writes tests/parity/inventory.json from a built site: every URL it serves, and for each HTML page
// what a reader sees of it (title, heading, description, the section tab, the sidebar, the table of
// contents, previous and next, its Markdown twin and social image). The parity suite
// (tests/parity/parity.spec.ts) checks a build against this record.
//
// It was run once on the Blume build the site had before it moved to First, so the record is what
// that site served. It reads Blume's markup; it is not meant to read any other build.
//
//   node tests/parity/inventory.mjs <dist dir>
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(process.argv[2] ?? "dist");
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "inventory.json");

// Files a Blume build writes for its own machinery, which no page links and no reader or agent is
// pointed at: the bundles, the search index, its redirect table, a Vercel config, and JSON and
// Markdown forms of the 404 page. The suite doesn't ask a later build for them.
const machinery = [/^\/_astro\//, /^\/blume-(search|redirects)\.json$/, /^\/vercel\.json$/, /^\/404\.(json|md)$/];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) yield* walk(file);
    else yield "/" + path.relative(dist, file).split(path.sep).join("/");
  }
}

const text = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const attr = (tag, name) => {
  const value = tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  return value === undefined ? undefined : text(value);
};
const pathOf = (url) => (url === undefined ? undefined : new URL(url, "https://site.invalid").pathname);
/** The inside of the first element that opens with `open`, balanced on its tag name. */
function element(html, open) {
  const start = html.indexOf(open);
  if (start < 0) return undefined;
  const tag = open.match(/^<([a-z-]+)/)[1];
  const re = new RegExp(`<(/?)${tag}[\\s>]`, "g");
  re.lastIndex = start + 1;
  let depth = 1;
  for (let m; (m = re.exec(html)); ) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return undefined;
}
const links = (html) => [...(html ?? "").matchAll(/<a\b[^>]*>/g)].map((m) => attr(m[0], "href")).filter((href) => href !== undefined);
/**
 * The sidebar as a reader sees it: each link's label and path, in order, under the heading of the
 * group it sits in (Blume's `meta.ts` titles and order), or none at the top level.
 */
function sidebarOf(tree) {
  const out = [];
  let group = null;
  for (const m of (tree ?? "").matchAll(/<p\b[^>]*>(.*?)<\/p>|<\/div><\/li>|<a\b([^>]*)>(.*?)<\/a>/gs)) {
    if (m[1] !== undefined) group = text(m[1]);
    else if (m[0].startsWith("</div>")) group = null;
    else if (m[2] !== undefined && group !== null && out.at(-1)?.group !== group && text(m[3]) === group) continue; // the group heading's own link
    else out.push({ label: text(m[3]), href: attr(`<a ${m[2]}>`, "href"), group });
  }
  return out;
}

const files = [...walk(dist)].sort();
const redirects = {};
for (const line of readFileSync(path.join(dist, "_redirects"), "utf8").split("\n")) {
  const [from, to, status] = line.trim().split(/\s+/);
  if (from && to) redirects[from] = { to, status: Number(status) };
}
// Static redirect pages the site carries in public/ (old addresses), besides Blume's _redirects.
for (const file of files.filter((f) => f.endsWith("/index.html"))) {
  const html = readFileSync(path.join(dist, file), "utf8");
  const refresh = html.match(/<meta http-equiv="refresh" content="0;\s*url=([^"]+)"/);
  const route = file.slice(0, -"/index.html".length);
  if (refresh && !redirects[route]) redirects[route] = { to: pathOf(new URL(refresh[1], `https://site.invalid${route}/`).href).replace(/\/$/, "") || "/", status: 301 };
}

const pages = {};
for (const file of files.filter((f) => f.endsWith(".html") && f !== "/404.html")) {
  const route = file === "/index.html" ? "/" : file.replace(/\/index\.html$/, "");
  if (redirects[route] || machinery.some((re) => re.test(file))) continue;
  const html = readFileSync(path.join(dist, file), "utf8");
  const head = html.slice(0, html.indexOf("<body"));
  const tags = [...head.matchAll(/<(?:meta|link)\b[^>]*>/g)].map((m) => m[0]);
  const find = (pred) => tags.find(pred);
  const main = element(html, "<main") ?? "";
  const tabs = element(html, '<nav aria-label="Sections"');
  const current = tabs && [...tabs.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).find((a) => attr(a, "aria-current") === "page");
  const pager = element(html, '<nav aria-label="Pagination"');
  const pagerLinks = [...(pager ?? "").matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs)].map((m) => ({ href: m[1], label: text(m[2]) }));
  const toc = element(html, '<aside aria-label="On this page"');
  pages[route] = {
    title: text(head.match(/<title>(.*?)<\/title>/s)?.[1] ?? ""),
    h1: text(main.match(/<h1\b[^>]*>(.*?)<\/h1>/s)?.[1] ?? ""),
    description: attr(find((t) => /name="description"/.test(t)) ?? "", "content") ?? null,
    canonical: pathOf(attr(find((t) => /rel="canonical"/.test(t)) ?? "", "href")) ?? null,
    markdown: attr(find((t) => /type="text\/markdown"/.test(t)) ?? "", "href") ?? null,
    ogImage: pathOf(attr(find((t) => /property="og:image"/.test(t)) ?? "", "content")) ?? null,
    tab: current ? attr(current, "href") : null,
    sidebar: sidebarOf(element(html, "<nav data-blume-nav-tree")),
    // The links in the head that point readers and agents at other forms of the site.
    head: tags
      .filter((t) => /^<link\b/.test(t) && /rel="(describedby|ai-catalog|ard|alternate)"/.test(t))
      .map((t) => ({ rel: attr(t, "rel"), href: pathOf(attr(t, "href")), type: attr(t, "type") ?? null }))
      .sort((a, b) => `${a.rel} ${a.href}`.localeCompare(`${b.rel} ${b.href}`)),
    social: {
      title: attr(find((t) => /property="og:title"/.test(t)) ?? "", "content") ?? null,
      card: attr(find((t) => /name="twitter:card"/.test(t)) ?? "", "content") ?? null,
    },
    // The tour's stops: each one an anchor a link can name.
    stops: [...main.matchAll(/<section\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1]),
    edit: attr([...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).find((a) => /\/edit\/main\//.test(a)) ?? "", "href") ?? null,
    toc: links(toc).filter((href) => href.startsWith("#")).map((href) => href.slice(1)),
    prev: pagerLinks.find((l) => l.label.startsWith("Previous"))?.href ?? null,
    next: pagerLinks.find((l) => l.label.startsWith("Next"))?.href ?? null,
  };
}

// The Markdown twin of each page (`/getting-started.md`), and the agent skill files.
const markdown = files.filter((f) => f.endsWith(".md") && !machinery.some((re) => re.test(f)));
const mdx = files.filter((f) => f.endsWith(".mdx"));
// _headers and _redirects are the host's configuration, not files it serves; what they do is
// recorded below. /files/ is what scripts/build-showcase.ts writes (each example's files, blueprint and plugins);
// its blobs and plugin files are named by content and version, so only its top-level entries are
// recorded.
const other = files.filter((f) => !f.endsWith(".html") && !/\.mdx?$/.test(f) && !machinery.some((re) => re.test(f)) && !/^\/files\/(blobs|plugins)\//.test(f) && !/^\/_(headers|redirects)$/.test(f));
// The response headers _headers sets, by path pattern (`/*.md`), for the suite to check.
const headers = {};
let pattern = null;
for (const line of readFileSync(path.join(dist, "_headers"), "utf8").split("\n")) {
  if (/^\S/.test(line)) pattern = line.trim();
  else if (line.trim() && pattern) (headers[pattern] ??= []).push(line.trim());
}
const dropped = files.filter((f) => machinery.some((re) => re.test(f)) && !f.startsWith("/_astro/"));

// A REST reference page names its operation as a line of its own: `GET /posts`.
for (const [route, page] of Object.entries(pages)) {
  if (!route.startsWith("/rest/")) continue;
  page.operation = readFileSync(path.join(dist, `${route}.md`), "utf8").match(/^`((?:GET|POST|PUT|PATCH|DELETE) \/\S*)`$/m)?.[1] ?? null;
}
// Each section shows one sidebar on all its pages: record it once, by the section's tab.
const sidebars = {};
for (const page of Object.values(pages)) {
  if (page.sidebar.length === 0) {
    delete page.sidebar;
    continue;
  }
  const key = page.tab;
  if (sidebars[key] && JSON.stringify(sidebars[key]) !== JSON.stringify(page.sidebar)) throw new Error(`two sidebars under ${key}`);
  sidebars[key] = page.sidebar;
  delete page.sidebar;
  page.sidebar = true;
}
const site = (url) => pathOf(url).replace(/(.)\/$/, "$1");
const sitemap = [...readFileSync(path.join(dist, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => site(m[1])).sort();
const llms = [...readFileSync(path.join(dist, "llms.txt"), "utf8").matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => site(m[1]));

writeFileSync(out, JSON.stringify({ pages, sidebars, redirects, headers, markdown, mdx, files: other, sitemap, llms, dropped }, null, "\t") + "\n");
console.log(`${Object.keys(pages).length} pages, ${Object.keys(redirects).length} redirects, ${markdown.length} Markdown twins, ${mdx.length} .mdx, ${other.length} other files, ${dropped.length} dropped`);
