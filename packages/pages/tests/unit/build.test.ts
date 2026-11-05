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
  assert.deepEqual(Object.values(index.regions).find((region) => region.kind === "show" && region.when.join(".") === "q1.length"), {
    kind: "show", when: ["q1", "length"], negate: true,
  });
  // The listing's links read each row's derived permalink.
  assert.ok(Object.values(index.tokens).some((t) => JSON.stringify(t.path) === JSON.stringify(["loop1", "@href:notes"])));
  const metadata = show.metadata.at(-1)!;
  assert.match(metadata.title!, /^\u{E000}v\d+\u{E001}$/u);
  assert.deepEqual(manifest.islands["fullsite/cheer"]!.actions, ["cheer"]);
  const island = (await readdir(path.join(plugin(root), "assets"))).filter((f) => f.startsWith("island-"));
  assert.equal(island.length, 1);
  // The browser module keeps its one runtime import external: WordPress provides it.
  assert.match(await readFile(path.join(plugin(root), "assets", island[0]!), "utf8"), /from\s*"@wordpress\/interactivity"/);

  const fallbacks = await project({ [NOTE_PAGE]: `import { collectionPage, orElse, Show } from "@spacefast/zero-pages";
export const page = collectionPage("notes");
export function load({ content, item }) {
  return { match: content.query.notes.findFirst({ where: { dek: orElse(orElse(item.dek, "fallback"), "second") } }) };
}
export default function Note({ item }) { return <Show when={orElse(orElse(item.dek, "fallback"), "second")}><h1>{item.title}</h1><p>{orElse(orElse(item.dek, "first"), "second")}</p></Show>; }
` });
  const compiled = await buildPages({ project: fallbacks, out: out(fallbacks) });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const fallbackRoute = (await manifestOf(fallbacks)).routes.find((route) => route.param !== null)!;
  assert.deepEqual(Object.values(fallbackRoute.regions), [{ kind: "show", when: ["item", "dek"], negate: false, fallback: "fallback" }]);
  assert.deepEqual(Object.values(fallbackRoute.queries), [{
    collection: "notes", op: "first", options: { where: { dek: { $zp: ["item", "dek"], fallback: "fallback" } } },
  }]);
  assert.deepEqual(Object.values(fallbackRoute.tokens).find((token) => token.path.join(".") === "item.dek"), {
    path: ["item", "dek"], mode: "child", fallback: "first",
  });

  const nonRows = await project({ [NOTE_PAGE]: `import { collectionPage, count } from "@spacefast/zero-pages";
export const page = collectionPage("notes");
export default function Note({ item }) { return <p>{count(item.title)}</p>; }
` });
  const invalidCount = await buildPages({ project: nonRows, out: out(nonRows) });
  assert.equal(invalidCount.ok, false);
  assert.equal(invalidCount.diagnostics.some((diagnostic) => diagnostic.code === "dynamic_value"), true);

  const namedFields = ["kind", "then", "$$typeof", "toString", "valueOf", "toJSON"];
  const protocols = await project({ [NOTE_PAGE]: `import { collectionPage } from "@spacefast/zero-pages";
export const page = collectionPage("notes");
export function load({ content, item }) {
  return { then: item.then, selected: content.query.notes.findFirst({ where: { kind: item.kind, then: item.then, $$typeof: item.$$typeof } }) };
}
export default function Note({ item, then, selected }) {
  return <><p>{item.kind}{then}{item.$$typeof}{item.toString}{item.valueOf}{item.toJSON}</p><p>{selected.kind}</p></>;
}
` });
  const snapshotFile = path.join(protocols, "zero/migrations/snapshot.json");
  const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
  for (const name of namedFields) snapshot.tables.notes.columns[name] = { type: "text" };
  await writeFile(snapshotFile, JSON.stringify(snapshot));
  const protocolResult = await buildPages({ project: protocols, out: out(protocols) });
  assert.equal(protocolResult.ok, true, JSON.stringify(protocolResult.diagnostics));
  const protocolRoute = (await manifestOf(protocols)).routes.find((route) => route.param !== null)!;
  assert.deepEqual(Object.values(protocolRoute.tokens).filter((token) => token.path[0] === "item").map((token) => token.path[1]), namedFields);
  assert.deepEqual(Object.values(protocolRoute.queries), [{
    collection: "notes", op: "first", options: { where: {
      kind: { $zp: ["item", "kind"] }, then: { $zp: ["item", "then"] }, $$typeof: { $zp: ["item", "$$typeof"] },
    } },
  }]);
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

  const root = await project();
  assert.equal((await buildPages({ project: root, out: out(root) })).ok, true);
  const before = (await manifestOf(root)).digest;
  const cases: [string, string][] = [
    ['return <h1>{item.dek === null ? "empty" : "present"}</h1>;', "dynamic_operator"],
    ['return <h1>{item.dek !== null && "present"}</h1>;', "dynamic_operator"],
    ['const { dek } = item; return <h1>{dek ? "present" : "empty"}</h1>;', "dynamic_region"],
    ['function Label({ value }) { return value ? "present" : "empty"; } return <h1><Label value={item.dek} /></h1>;', "dynamic_region"],
    ['return <h1>{Boolean(item.dek)}</h1>;', "dynamic_call"],
    ['const truthy = Boolean; return <h1>{truthy(item.dek)}</h1>;', "dynamic_call"],
    ['return <h1>{Object.is(item.dek, null)}</h1>;', "dynamic_call"],
    ['return <h1>{typeof item.dek}</h1>;', "dynamic_operator"],
    ['return <h1>{`${item.dek}` === "" ? "empty" : "present"}</h1>;', "dynamic_operator"],
    ['if (item.dek) return <h1>present</h1>; return <h1>empty</h1>;', "dynamic_region"],
    ['switch (item.dek) { case null: return <h1>empty</h1>; default: return <h1>present</h1>; }', "dynamic_region"],
    ['while (item.dek) return <h1>present</h1>; return <h1>empty</h1>;', "dynamic_region"],
    ['do { return <h1>present</h1>; } while (item.dek);', "dynamic_region"],
    ['for (; item.dek;) return <h1>present</h1>; return <h1>empty</h1>;', "dynamic_region"],
    ['switch ("x") { case item.dek: return <h1>match</h1>; default: return <h1>other</h1>; }', "dynamic_operator"],
    ['for (const character of `${item.dek}`) return <h1>{character}</h1>; return <h1>empty</h1>;', "dynamic_region"],
    ['for (const key in `${item.dek}`) return <h1>{key}</h1>; return <h1>empty</h1>;', "dynamic_region"],
    ['const tag = (parts, value) => value; return <h1>{tag`${item.dek}`}</h1>;', "dynamic_call"],
    ['return <h1>{`${item.dek}`.length}</h1>;', "dynamic_operator"],
    ['return <h1>{String(item.dek).length}</h1>;', "dynamic_operator"],
    ['const title = String(item.dek); return <h1>{title.length}</h1>;', "dynamic_operator"],
    ['const title = `${item.dek}`; return <h1>{title[0]}</h1>;', "dynamic_operator"],
    ['function Label({ value }) { return value.length; } return <h1><Label value={`${item.dek}`} /></h1>;', "dynamic_operator"],
    ['const { dek = "fallback" } = item; return <h1>{dek}</h1>;', "dynamic_region"],
    ['const { now } = Date; return <h1>{now()}</h1>;', "dynamic_call"],
    ['const { now } = Date; return <h1>{now(1)}</h1>;', "dynamic_call"],
    ['const { length: size } = String(item.title); return <h1>{size}</h1>;', "dynamic_operator"],
    ['const { length: size } = `${item.title}`; return <h1>{size}</h1>;', "dynamic_operator"],
    ['function Label({ length: size }) { return size; } return <h1><Label {...`${item.title}`} /></h1>;', "dynamic_operator"],
  ];
  for (const [body, code] of cases) {
    await writeFile(path.join(root, NOTE_PAGE), `import { collectionPage } from "@spacefast/zero-pages";
export const page = collectionPage("notes");
export default function Note({ item }) { ${body} }
`);
    const result = await buildPages({ project: root, out: out(root) });
    assert.equal(result.ok, false, body);
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === code), true, JSON.stringify(result.diagnostics));
    assert.equal((await manifestOf(root)).digest, before, body);
  }

  // A query result passed under an arbitrary prop name is still request data.
  await writeFile(path.join(root, NOTE_PAGE), `import { collectionPage } from "@spacefast/zero-pages";
export const page = collectionPage("notes");
export function load({ content: viewerContent }) { return { found: viewerContent.query.notes.findFirst() }; }
export default function Note({ found }) { return <h1>{found.dek ? "present" : "empty"}</h1>; }
`);
  const loader = await buildPages({ project: root, out: out(root) });
  assert.equal(loader.ok, false);
  assert.equal(loader.diagnostics.some((diagnostic) => diagnostic.code === "dynamic_region"), true);
  assert.equal((await manifestOf(root)).digest, before);

  // Literal and immutable primitive const conditions are safe, and imported
  // helper aliases keep the documented per-request escape hatches usable.
  await writeFile(path.join(root, NOTE_PAGE), `import { collectionPage as routeFor, orElse as fallback } from "@spacefast/zero-pages";
export const page = routeFor("notes");
const enabled = true;
const label = "notes";
export default function Note({ item }) {
  return enabled && label === "notes" ? <h1>{fallback(item.dek, "empty")}</h1> : <h1>disabled</h1>;
}
`);
  const safe = await buildPages({ project: root, out: out(root) });
  assert.equal(safe.ok, true, JSON.stringify(safe.diagnostics));

  // Helpers outside the project and in npm packages are checked too: JSX
  // component props can carry symbolic values even without a direct call.
  const labelSource = 'export default function Label({ value }) { return <p>{value ? "present" : "missing"}</p>; }';
  const external = path.join(scratch, "external-label.tsx");
  await writeFile(external, labelSource);
  const externalPage = (specifier: string) => `import { collectionPage } from "@spacefast/zero-pages";
import Label from ${JSON.stringify(specifier)};
export const page = collectionPage("notes");
export default function Note({ item }) { return <Label value={item.dek} />; }
`;
  const beforeImports = (await manifestOf(root)).digest;
  await writeFile(path.join(root, NOTE_PAGE), externalPage(external));
  const outside = await buildPages({ project: root, out: out(root) });
  assert.equal(outside.ok, false);
  assert.equal(outside.diagnostics.some((diagnostic) => diagnostic.code === "dynamic_region" && diagnostic.loc?.file === external), true);
  assert.equal((await manifestOf(root)).digest, beforeImports);

  const dependency = path.join(root, "node_modules/review-label");
  await mkdir(dependency, { recursive: true });
  await writeFile(path.join(dependency, "package.json"), JSON.stringify({ name: "review-label", type: "module", main: "index.tsx" }));
  await writeFile(path.join(dependency, "index.tsx"), labelSource);
  await writeFile(path.join(root, NOTE_PAGE), externalPage("review-label"));
  const installed = await buildPages({ project: root, out: out(root) });
  assert.equal(installed.ok, false);
  assert.equal(installed.diagnostics.some((diagnostic) => diagnostic.code === "dynamic_region" && diagnostic.loc?.file === path.join(dependency, "index.tsx")), true);
  assert.equal((await manifestOf(root)).digest, beforeImports);
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
  const missingLink = await refusal("pages/about/page.tsx", `import { link } from "@spacefast/zero-pages";
export default function About() { return <a href={link("/missing")}>Missing</a>; }
`);
  assert.deepEqual(missingLink.diagnostics.map((diagnostic) => diagnostic.code), ["unknown_route"]);
  assert.equal(missingLink.kept, true);
  assert.match(result.diagnostics[0]!.message, /Did you mean "title"\?/);
});

test("per-request values are refused where PHP could not escape them or where they would change structure", async () => {
  const cases: [string, string, string][] = [
    ["dynamic_attribute", `<p className={item.slug}>x</p>`, "5:5"],
    ["dynamic_operator", `<p>{item.title + "!"}</p>`, "5:9"],
    ["dynamic_call", `<p>{item.title.toUpperCase()}</p>`, "5:9"],
    ["rich_text", `<RichText value={orElse(item.body, "fallback")} />`, "5:5"],
  ];
  for (const [code, jsx, at] of cases) {
    const root = await project({ [NOTE_PAGE]: `import { collectionPage, RichText, orElse, type CollectionPageProps } from "@spacefast/zero-pages";
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
  const shared = await manifestOf(root);
  assert.deepEqual(Object.keys(shared.islands), ["fullsite/cheer"]);
  assert.deepEqual(shared.routes.filter((route) => route.modules.includes("fullsite/cheer")).map((route) => route.pattern).sort(), ["/about", "/notes/[]"]);

  await writeFile(path.join(root, "islands/alternative.client.ts"), "export const alternative = true;\n");
  await writeFile(path.join(root, "pages/about/page.tsx"), `import { Island } from "@spacefast/zero-pages";
export default function About() {
  return <Island namespace="fullsite/cheer" module="../../islands/alternative.client.ts"><p>Alternative</p></Island>;
}
`);
  const conflict = await buildPages({ project: root, out: out(root) });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.diagnostics.some((diagnostic) => diagnostic.code === "island"), true);
  assert.equal((await manifestOf(root)).digest, shared.digest);

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
