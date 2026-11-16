import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { withBlockApi } from "@spacefast/zero-blocks/compiler";

import { buildPages, type Manifest } from "../../src/build.ts";
import { routeId, routeKey } from "../../src/routes.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const example = path.resolve(here, "../../../../examples/full-site");
const scratch = await mkdtemp(path.join(tmpdir(), "zero-pages-test-"));
after(() => rm(scratch, { recursive: true, force: true }));

let counter = 0;
/** A disposable copy of the full-site example (sources and its compiled schema), with files replaced. */
async function project(files: Record<string, string | null> = {}): Promise<string> {
  const root = path.join(scratch, `p${counter++}`);
  for (const entry of ["zero.config.ts", "pages", "components", "islands", "styles", "zero/client", "zero/migrations"]) {
    await cp(path.join(example, entry), path.join(root, entry), { recursive: true });
  }
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(root, file);
    if (contents === null) await rm(target, { recursive: true, force: true });
    else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
  }
  return root;
}

const out = (root: string): string => path.join(root, ".out");
const plugin = (root: string): string => path.join(out(root), "plugins/zero-pages-fullsite");
const manifestOf = async (root: string): Promise<Manifest> => JSON.parse(await readFile(path.join(plugin(root), "manifest.json"), "utf8")) as Manifest;
const brief = (d: { code: string; loc?: { file: string; line: number; column: number } }, root: string) =>
  ({ code: d.code, at: d.loc === undefined ? null : `${path.relative(root, d.loc.file)}:${d.loc.line}:${d.loc.column}` });

interface Parsed { name: string; isValid: boolean; attributes: Record<string, unknown>; originalContent: string; innerBlocks: Parsed[] }
async function parse(markup: string): Promise<Parsed[]> {
  return withBlockApi((api) => api.parse(markup) as unknown as Parsed[]);
}
function flatten(blocks: readonly Parsed[]): Parsed[] {
  return blocks.flatMap((block) => [block, ...flatten(block.innerBlocks)]);
}

test("the full-site example builds every route to block markup the editor parses as valid", async () => {
  const root = await project();
  const result = await buildPages({ project: root, out: out(root) });
  assert.deepEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
  assert.equal(result.ok, true);
  const manifest = await manifestOf(root);
  assert.deepEqual(manifest.routes.map((r) => [r.pattern, r.param, r.id]).sort(), [
    ["/", null, "u:home"],
    ["/about", null, routeId("/about", null)],
    ["/notes", null, "u:notes.index"],
    ["/notes/[]", "slug", "u:notes.show"],
    ["/notes/featured", null, "u:notes.featured"],
  ]);
  assert.equal(routeId("/about", null), "p:2f61626f7574");
  for (const route of [...manifest.routes, manifest.notFound!]) {
    assert.equal(route.key, routeKey("fullsite", route.id));
    const blocks = flatten(await parse(await readFile(path.join(plugin(root), route.template), "utf8")));
    assert.ok(blocks.length > 0);
    // Region blocks are registered only on the server; every core block must be valid as saved.
    assert.deepEqual(blocks.filter((b) => !b.name.startsWith("zero-pages/") && !b.isValid).map((b) => b.name), []);
  }
  // Static pages carry their own body for the hidden Page; item routes use the item's post.
  const about = manifest.routes.find((r) => r.pattern === "/about")!;
  assert.match(await readFile(path.join(plugin(root), about.body!), "utf8"), /<!-- wp:heading \{"level":1\} -->/);
  assert.equal(manifest.routes.find((r) => r.param !== null)!.body, null);
  // The static sibling reserves its slug on the item route.
  assert.deepEqual(manifest.routes.find((r) => r.param !== null)!.reserved, ["featured"]);
  assert.equal(manifest.notFound?.pattern, "/404");
});

test("dynamic data becomes viewer-bound queries, loops, conditions and tokens, never build-time values", async () => {
  const root = await project();
  await buildPages({ project: root, out: out(root) });
  const manifest = await manifestOf(root);
  const show = manifest.routes.find((r) => r.id === "u:notes.show")!;
  assert.deepEqual(Object.values(show.queries), [{ collection: "cheers", op: "first", options: { where: { noteId: { $zp: ["item", "id"] } } } }]);
  assert.deepEqual(Object.values(show.regions).map((r) => r.kind).sort(), ["island", "rich-text", "show", "show"]);
  const index = manifest.routes.find((r) => r.id === "u:notes.index")!;
  // The listing's empty state, and NoteCard's `dek` condition inside the loop body.
  assert.deepEqual(Object.values(index.regions).map((r) => r.kind).sort(), ["each", "show", "show"]);
  // The listing's links read each row's derived permalink.
  assert.ok(Object.values(index.tokens).some((t) => JSON.stringify(t.path) === JSON.stringify(["loop1", "@href:notes"])));
  const metadata = show.metadata.at(-1)!;
  assert.match(metadata.title!, /^\u{E000}v\d+\u{E001}$/u);
  assert.deepEqual(manifest.islands["fullsite/cheer"]!.actions, ["cheer"]);
  const island = (await readdir(path.join(plugin(root), "assets"))).filter((f) => f.startsWith("island-"));
  assert.equal(island.length, 1);
  // The browser module keeps its one runtime import external: WordPress provides it.
  assert.match(await readFile(path.join(plugin(root), "assets", island[0]!), "utf8"), /from\s*"@wordpress\/interactivity"/);
});

test("CSS modules become hashed class names, global CSS and file imports become hashed assets", async () => {
  const root = await project();
  await buildPages({ project: root, out: out(root) });
  const manifest = await manifestOf(root);
  const show = manifest.routes.find((r) => r.id === "u:notes.show")!;
  const about = manifest.routes.find((r) => r.pattern === "/about")!;
  const css = await readFile(path.join(plugin(root), show.css[0]!), "utf8");
  assert.match(css, /\.note_note\s*\{/);
  assert.match(css, /body\.zero-pages/);
  assert.match(await readFile(path.join(plugin(root), show.template), "utf8"), /"className":"note_note"/);
  const assets = await readdir(path.join(plugin(root), "assets"));
  assert.ok(assets.some((f) => /^compass-[A-Z0-9]+\.svg$/.test(f)));
  assert.match(await readFile(path.join(plugin(root), about.template), "utf8"), /src="\u{E000}asset\u{E001}\/compass-[A-Z0-9]+\.svg"/u);
});

test("no pages/ directory builds nothing and writes nothing", async () => {
  const root = await project({ pages: null });
  const result = await buildPages({ project: root, out: out(root) });
  assert.deepEqual([result.ok, result.pages, result.diagnostics], [true, false, []]);
  await assert.rejects(readdir(out(root)), { code: "ENOENT" });
});

const NOTE_PAGE = "pages/notes/[slug]/page.tsx";
async function refusal(file: string, contents: string): Promise<{ root: string; diagnostics: { code: string; at: string | null }[]; kept: boolean }> {
  const root = await project();
  const first = await buildPages({ project: root, out: out(root) });
  assert.equal(first.ok, true);
  const before = (await manifestOf(root)).digest;
  await writeFile(path.join(root, file), contents);
  const result = await buildPages({ project: root, out: out(root) });
  assert.equal(result.ok, false);
  return { root, diagnostics: result.diagnostics.filter((d) => d.severity === "error").map((d) => brief(d, root)), kept: (await manifestOf(root)).digest === before };
}

test("a branch on request data is refused at its location and the previous output stays", async () => {
  const { diagnostics, kept } = await refusal(NOTE_PAGE, `import { collectionPage, type CollectionPageProps } from "@spacefast/zero-pages";
export const page = collectionPage("notes");
export default function Note({ item }: CollectionPageProps<typeof page>) {
  return <h1>{item.dek ? item.title : "Untitled"}</h1>;
}
`);
  assert.deepEqual(diagnostics, [{ code: "dynamic_region", at: `${NOTE_PAGE}:4:15` }]);
  assert.equal(kept, true);
});

test("a typo in a field is refused with the field's line and a suggestion", async () => {
  const root = await project({ [NOTE_PAGE]: `import { collectionPage, type CollectionPageProps } from "@spacefast/zero-pages";
export const page = collectionPage("notes");
export default function Note({ item }: CollectionPageProps<typeof page>) {
  // @ts-expect-error the field does not exist
  return <h1>{item.titel}</h1>;
}
` });
  const result = await buildPages({ project: root, out: out(root) });
  assert.deepEqual(result.diagnostics.map((d) => brief(d, root)), [{ code: "unknown_field", at: `${NOTE_PAGE}:5:20` }]);
  assert.match(result.diagnostics[0]!.message, /Did you mean "title"\?/);
});

test("per-request values are refused where PHP could not escape them or where they would change structure", async () => {
  const cases: [string, string, string][] = [
    ["dynamic_attribute", `<p className={item.slug}>x</p>`, "5:5"],
    ["dynamic_operator", `<p>{item.title + "!"}</p>`, "5:20"],
    ["dynamic_call", `<p>{item.title.toUpperCase()}</p>`, "5:20"],
  ];
  for (const [code, jsx, at] of cases) {
    const root = await project({ [NOTE_PAGE]: `import { collectionPage, type CollectionPageProps } from "@spacefast/zero-pages";
export const page = collectionPage("notes");
export default function Note({ item }: CollectionPageProps<typeof page>) {
  return (
    ${jsx}
  );
}
` });
    const result = await buildPages({ project: root, out: out(root) });
    assert.deepEqual(result.diagnostics.map((d) => brief(d, root)), [{ code, at: `${NOTE_PAGE}:${at}` }], jsx);
  }
});

test("the trusted db, async components and build-time clocks are refused before any page code runs", async () => {
  const root = await project({ "pages/about/page.tsx": `import { db } from "zero";
export default async function About() {
  const now = Date.now();
  return <p>{String(now)}</p>;
}
` });
  const result = await buildPages({ project: root, out: out(root) });
  assert.deepEqual(result.diagnostics.map((d) => brief(d, root)), [
    { code: "trusted_db", at: "pages/about/page.tsx:1:10" },
    { code: "async_component", at: "pages/about/page.tsx:2:1" },
    { code: "dynamic_call", at: "pages/about/page.tsx:3:15" },
  ]);
  // Nothing ran: no output exists for a first build that was refused.
  await assert.rejects(readdir(out(root)), { code: "ENOENT" });
});

test("route shapes the release cannot serve are refused, not approximated", async () => {
  const cases: [Record<string, string>, { code: string; at: string }[]][] = [
    [{ "pages/docs/[...rest]/page.tsx": "export default () => <p>x</p>;\n" }, [{ code: "route_shape", at: "pages/docs/[...rest]:1:1" }]],
    [{ "pages/(marketing)/about/page.tsx": "export default () => <p>x</p>;\n" }, [{ code: "route_collision", at: "pages/about/page.tsx:1:1" }]],
    [{ "pages/wp-admin/page.tsx": "export default () => <p>x</p>;\n" }, [{ code: "reserved_path", at: "pages/wp-admin/page.tsx:1:1" }]],
    [{ "pages/help/page.md": "# Help\n" }, [{ code: "route_shape", at: "pages/help/page.md:1:1" }]],
  ];
  for (const [files, expected] of cases) {
    const root = await project(files);
    const result = await buildPages({ project: root, out: out(root) });
    assert.deepEqual(result.diagnostics.map((d) => brief(d, root)), expected, JSON.stringify(files));
  }
});

test("a second item route for one collection and an item route over a table are refused", async () => {
  const twice = await project({ "pages/n/[slug]/page.tsx": `import { collectionPage } from "@spacefast/zero-pages";
export const page = collectionPage("notes");
export default () => <p>x</p>;
` });
  const result = await buildPages({ project: twice, out: out(twice) });
  assert.deepEqual(result.diagnostics.map((d) => brief(d, twice)), [{ code: "not_routable", at: "pages/notes/[slug]/page.tsx:1:1" }]);
  const table = await project({ "pages/c/[slug]/page.tsx": `import { collectionPage } from "@spacefast/zero-pages";
export const page = collectionPage("cheers");
export default () => <p>x</p>;
` });
  const refused = await buildPages({ project: table, out: out(table) });
  assert.deepEqual(refused.diagnostics.map((d) => brief(d, table)), [{ code: "not_routable", at: "pages/c/[slug]/page.tsx:2:21" }]);
});

test("island children are escaped HTML and event-handler attributes are refused", async () => {
  const root = await project({ "pages/about/page.tsx": `import { Island } from "@spacefast/zero-pages";
export default function About() {
  return (
    <Island namespace="fullsite/cheer" module="../../islands/cheer.client.ts">
      <p title={'"><script>'}>{"<b>not bold</b>"}</p>
    </Island>
  );
}
` });
  const result = await buildPages({ project: root, out: out(root) });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const about = (await manifestOf(root)).routes.find((r) => r.pattern === "/about")!;
  const html = flatten(await parse(await readFile(path.join(plugin(root), about.template), "utf8"))).find((b) => b.name === "core/html")!;
  assert.equal(html.originalContent, '<p title="&quot;&gt;&lt;script&gt;">&lt;b&gt;not bold&lt;/b&gt;</p>');

  const handler = await project({ "pages/about/page.tsx": `import { Island } from "@spacefast/zero-pages";
export default function About() {
  return (
    <Island namespace="fullsite/cheer" module="../../islands/cheer.client.ts">
      <button onclick="alert(1)">x</button>
    </Island>
  );
}
` });
  const refused = await buildPages({ project: handler, out: out(handler) });
  assert.deepEqual(refused.diagnostics.map((d) => d.code), ["island"]);
});

test("rebuilding unchanged sources keeps route IDs, keys and the manifest digest", async () => {
  const root = await project();
  await buildPages({ project: root, out: out(root) });
  const first = await manifestOf(root);
  await buildPages({ project: root, out: out(root) });
  const second = await manifestOf(root);
  assert.equal(second.digest, first.digest);
  assert.deepEqual(second.routes.map((r) => [r.id, r.key]), first.routes.map((r) => [r.id, r.key]));
});
