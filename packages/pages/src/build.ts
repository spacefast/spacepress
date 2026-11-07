/**
 * `zero-pages build`: `pages/**` to a WordPress plugin beside the app's own.
 *
 * Steps, each one only when the previous produced no error:
 *
 * 1. Read the app's schema from `zero build` output (`zero/client/schema.ts`
 *    and `zero/migrations/snapshot.json`); pages never execute
 *    `zero.config.ts`.
 * 2. Discover routes, layouts and `not-found.tsx` (routes.ts).
 * 3. Bundle each route with esbuild and check every project file in its
 *    import graph (check.ts) before any of it runs.
 * 4. Execute each route once with symbolic request data (render.ts) and
 *    serialize its document with Zero Blocks' pinned serializer.
 * 5. Bundle CSS, file assets and island client modules into hashed files.
 * 6. Write the render artifact, `zero/pages.json`: the manifest bytes, every
 *    template, body and asset, the schema the pages were rendered against and
 *    a hash of each text input. It holds no PHP. `zero sources` captures it and
 *    the host compiler (`compile-sources`) validates it and emits the same
 *    plugin from it, so a hosted app needs no JavaScript on the server.
 * 7. Write `plugins/zero-pages-<app>/` from that artifact to a sibling temp
 *    directory and swap it in. On any error nothing is written and the
 *    previous output stays.
 */
import { createHash, randomUUID } from "node:crypto";
import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { SourceMap } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { mapToBlocks, serializeBlocks } from "@spacefast/zero-blocks/compiler";
import type { BlockNode, ContentNode } from "@spacefast/zero-blocks";
import { build as esbuild, type Metafile, type OutputFile, type Plugin } from "esbuild";

import { checkSource } from "./check.ts";
import { hasErrors, type PagesDiagnostic } from "./diagnostics.ts";
import { displayPattern, discover, reservedSiblings, routeId, routeKey, type RouteFile } from "./routes.ts";
import type { MetadataOut, Rendered } from "./render.ts";
import { ASSET_TOKEN, TOKEN_END, TOKEN_START, type BuildInput, type CollectionInfo, type SchemaInfo } from "./symbolic.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
/** The plugin's PHP: `wp/` in a packed package, `runtime/pages/` (which the Zero compiler embeds) in a checkout. */
const wpRuntime = async (): Promise<string> => {
  const packed = path.join(packageRoot, "wp");
  return (await exists(packed)) ? packed : path.resolve(packageRoot, "../../runtime/pages");
};
const moduleExtension = path.extname(fileURLToPath(import.meta.url));
const blocksRoot = path.dirname(fileURLToPath(import.meta.resolve("@spacefast/zero-blocks/package.json")));
const SELF = /^@spacefast\/zero-pages(?:\/(jsx-runtime|jsx-dev-runtime))?$/;

export interface BuildOptions {
  /** The Zero project directory (holds zero.config.ts and pages/). */
  project: string;
  /** The wp-content directory to write `plugins/zero-pages-<app>/` into. */
  out: string;
}

export interface BuildResult {
  ok: boolean;
  /** False when the project has no pages/ directory: nothing was built or written. */
  pages: boolean;
  diagnostics: PagesDiagnostic[];
  plugin?: string;
  manifest?: Manifest;
  /** The project's `zero/pages.json`. */
  artifact?: string;
}

/**
 * `zero/pages.json`: everything the plugin needs except its PHP, which the
 * installer (this package, or Zero's host compiler) supplies itself.
 * `manifest` is the exact text of the plugin's manifest.json; `files` are
 * base64, keyed by their path inside the plugin.
 */
export interface Artifact {
  format: "zero.pages.v1";
  app: string;
  /** The compiled schema the pages were rendered against, as read from `zero build` output. */
  schema: AppSchema;
  /** Project-relative text inputs (routes, layouts, components, islands, CSS) → SHA-256 of their bytes. */
  inputs: Record<string, string>;
  manifest: string;
  files: Record<string, string>;
}

export const ARTIFACT_FILE = "zero/pages.json";

export interface ManifestRoute {
  id: string;
  key: string;
  pattern: string;
  param: string | null;
  source: string;
  collection: string | null;
  slugColumn: string | null;
  postType: string | null;
  title: string;
  template: string;
  body: string | null;
  bodyDigest: string | null;
  css: string[];
  modules: string[];
  metadata: MetadataOut[];
  tokens: Rendered["tokens"];
  regions: Rendered["regions"];
  queries: Rendered["queries"];
  reserved: string[];
}

export interface Manifest {
  version: 1;
  app: string;
  digest: string;
  routes: ManifestRoute[];
  notFound: ManifestRoute | null;
  islands: Record<string, { namespace: string; file: string; actions: string[] }>;
}

const exists = (file: string): Promise<boolean> => access(file).then(() => true, () => false);

function error(code: PagesDiagnostic["code"], message: string, file?: string, hint?: string): PagesDiagnostic {
  const diagnostic: PagesDiagnostic = { code, severity: "error", message };
  if (file !== undefined) diagnostic.loc = { file, line: 1, column: 1 };
  if (hint !== undefined) diagnostic.hint = hint;
  return diagnostic;
}

// ---------------------------------------------------------------------------
// 1. Schema

export interface AppSchema {
  app: string;
  schema: SchemaInfo;
  postTypes: Record<string, string>;
  actions: string[];
}

async function loadSchema(project: string): Promise<AppSchema | PagesDiagnostic> {
  const clientFile = path.join(project, "zero/client/schema.ts");
  const snapshotFile = path.join(project, "zero/migrations/snapshot.json");
  if (!(await exists(clientFile)) || !(await exists(snapshotFile))) {
    return error("config", "Pages build from the app's compiled schema; run `zero build` first.", path.join(project, "zero.config.ts"));
  }
  const client = await readFile(clientFile, "utf8");
  const match = /export const SCHEMA = (\{[\s\S]*\}) as const;/.exec(client);
  if (match === null) return error("config", "zero/client/schema.ts is not the shape `zero build` writes; rebuild the app.", clientFile);
  const described = JSON.parse(match[1]!) as { name: string; collections: Record<string, unknown>; actions: string[] };
  const snapshot = JSON.parse(await readFile(snapshotFile, "utf8")) as {
    tables: Record<string, { editor?: boolean; columns: Record<string, { type: string }> }>;
  };
  const schema: SchemaInfo = {};
  const postTypes: Record<string, string> = {};
  for (const name of Object.keys(described.collections)) {
    const table = snapshot.tables[name];
    if (table === undefined) {
      return error("config", `"${name}" is stored under another physical name; pages do not support renamed storage bindings yet.`, path.join(project, "zero.config.ts"));
    }
    const columns: CollectionInfo["columns"] = {};
    let slug: string | null = null;
    for (const [column, def] of Object.entries(table.columns)) {
      columns[column] = { type: def.type };
      if (def.type === "slug") slug = column;
    }
    schema[name] = { editor: table.editor === true, slug, columns };
    // Zero's WordPress post type for a collection: `zero_<physical name>`, as the app plugin registers it.
    if (table.editor === true) postTypes[name] = `zero_${name}`;
  }
  return { app: described.name, schema, postTypes, actions: [...described.actions] };
}

// ---------------------------------------------------------------------------
// 3. Bundling

function pagesPlugin(): Plugin {
  return {
    name: "zero-pages",
    setup(b) {
      b.onResolve({ filter: SELF }, (args) => {
        const sub = SELF.exec(args.path)?.[1];
        return { path: path.join(here, `${sub === undefined ? "index" : "jsx-runtime"}${moduleExtension}`) };
      });
      b.onResolve({ filter: /^zero$/ }, () => ({
        errors: [{ text: 'Pages cannot import runtime values from "zero" or execute zero.config.ts; import types only, and name collections as strings (collectionPage("notes")).' }],
      }));
    },
  };
}

interface Bundle {
  code: string;
  map: SourceMap;
  css: string | null;
  files: OutputFile[];
  inputs: string[];
  /** Every text file the bundle read, inside the project: the inputs a stale artifact is detected by. */
  texts: string[];
}

const FILE_LOADERS = Object.fromEntries([".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".woff", ".woff2"].map((ext) => [ext, "file" as const]));

async function bundleRoute(root: string, entry: string, scratch: string): Promise<Bundle | PagesDiagnostic[]> {
  try {
    const result = await esbuild({
      stdin: { contents: entry, resolveDir: root, sourcefile: "zero-pages-route.ts", loader: "ts" },
      absWorkingDir: root,
      bundle: true,
      format: "esm",
      platform: "neutral",
      mainFields: ["module", "main"],
      conditions: ["import", "default"],
      target: "es2023",
      jsx: "automatic",
      jsxDev: true,
      jsxImportSource: "@spacefast/zero-pages",
      tsconfigRaw: {},
      define: { "globalThis.__zeroBlocksSourceRoot": JSON.stringify(root) },
      loader: FILE_LOADERS,
      publicPath: ASSET_TOKEN,
      assetNames: "[name]-[hash]",
      entryNames: "route",
      outdir: scratch,
      sourcemap: "external",
      sourcesContent: false,
      metafile: true,
      write: false,
      logLevel: "silent",
      plugins: [pagesPlugin()],
    });
    const js = result.outputFiles.find((file) => file.path === path.join(scratch, "route.js"))!;
    const mapFile = result.outputFiles.find((file) => file.path === path.join(scratch, "route.js.map"))!;
    const cssFile = result.outputFiles.find((file) => file.path === path.join(scratch, "route.css"));
    return {
      code: js.text,
      map: new SourceMap(JSON.parse(mapFile.text) as ConstructorParameters<typeof SourceMap>[0]),
      css: cssFile?.text ?? null,
      files: result.outputFiles.filter((file) => !/route\.(js|css)(\.map)?$/.test(path.basename(file.path))),
      inputs: projectInputs(root, result.metafile),
      texts: projectTexts(root, result.metafile),
    };
  } catch (failure) {
    const messages = (failure as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors ?? [];
    if (messages.length === 0) return [error("module_failed", failure instanceof Error ? failure.message : String(failure))];
    return messages.map((message) => {
      const diagnostic: PagesDiagnostic = { code: "module_failed", severity: "error", message: message.text };
      if (message.location) diagnostic.loc = { file: path.resolve(root, message.location.file), line: message.location.line, column: message.location.column + 1 };
      return diagnostic;
    });
  }
}

/** Check every imported helper too; only the pinned Pages and Blocks implementations are trusted. */
function projectInputs(root: string, metafile: Metafile): string[] {
  return Object.keys(metafile.inputs)
    .map((input) => path.resolve(root, input))
    .filter((file) => !file.startsWith(`${packageRoot}${path.sep}`) && !file.startsWith(`${blocksRoot}${path.sep}`)
      && path.basename(file) !== "zero-pages-route.ts" && /\.(?:[cm]?[jt]sx?)$/.test(file));
}

/** Every text an esbuild route or island bundle can inline: code, CSS, JSON and imported SVG. */
const TEXT_INPUT = /\.(?:[cm]?[jt]sx?|css|json|svg)$/;

/** Authored text files a bundle read inside the project; the pinned Pages and Blocks code is not an input. */
function projectTexts(root: string, metafile: Metafile): string[] {
  return Object.keys(metafile.inputs)
    .map((input) => path.resolve(root, input))
    .filter((file) => file.startsWith(`${root}${path.sep}`) && !file.startsWith(`${packageRoot}${path.sep}`) && !file.startsWith(`${blocksRoot}${path.sep}`)
      && path.basename(file) !== "zero-pages-route.ts" && TEXT_INPUT.test(file));
}

// ---------------------------------------------------------------------------
// 4. Execution

interface Located {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  loc?: { file: string; line: number; column: number; usedAt?: unknown };
  pagesLoc?: { fileName: string; line: number; column: number };
  stack?: unknown;
}

/** The first stack frame that maps to an authored file: the line that made the mistake. */
function authoredFrame(failure: Located, bundle: string, map: SourceMap, scratch: string, root: string): PagesDiagnostic["loc"] {
  if (typeof failure.stack !== "string") return undefined;
  const url = pathToFileURL(bundle).href;
  for (const line of failure.stack.split("\n")) {
    const at = line.indexOf(`${url}:`);
    if (at === -1) continue;
    const position = /^(\d+):(\d+)\)?\s*$/.exec(line.slice(at + url.length + 1));
    if (position === null) continue;
    const origin = map.findOrigin(Number(position[1]), Number(position[2]));
    if (!("fileName" in origin) || typeof origin.fileName !== "string") continue;
    const source = path.resolve(scratch, decodeURIComponent(origin.fileName));
    if (!source.startsWith(`${root}${path.sep}`) || source.startsWith(`${packageRoot}${path.sep}`) || source.includes(`${path.sep}node_modules${path.sep}`)) continue;
    return { file: source, line: origin.lineNumber, column: origin.columnNumber };
  }
  return undefined;
}

function failureDiagnostic(failure: unknown, fallbackFile: string, bundle: string, map: SourceMap, scratch: string, root: string): PagesDiagnostic {
  const located = (failure ?? {}) as Located;
  const name = typeof located.name === "string" ? located.name : "";
  const known = (name === "PagesError" || name === "ContentError") && typeof located.code === "string";
  const diagnostic: PagesDiagnostic = {
    code: known ? (located.code as PagesDiagnostic["code"]) : "module_failed",
    severity: "error",
    message: typeof located.message === "string" ? located.message : String(failure),
  };
  const loc = authoredFrame(located, bundle, map, scratch, root)
    ?? (located.loc !== undefined && typeof located.loc.file === "string" ? located.loc as PagesDiagnostic["loc"] : undefined)
    ?? (located.pagesLoc !== undefined ? { file: path.resolve(root, located.pagesLoc.fileName), line: located.pagesLoc.line, column: located.pagesLoc.column } : undefined)
    ?? { file: fallbackFile, line: 1, column: 1 };
  if (loc !== undefined) diagnostic.loc = loc;
  return diagnostic;
}

declare global {
  // eslint-disable-next-line no-var
  var __zeroPagesBuild: BuildInput | undefined;
}

async function importRoute<T>(code: string, scratch: string, phase: string, input: BuildInput, run: (module: Record<string, unknown>) => Promise<T>): Promise<T> {
  const file = path.join(scratch, `route-${phase}.mjs`);
  await writeFile(file, code);
  // The registry reads this once, while the module evaluates; each route and phase gets a fresh module.
  globalThis.__zeroPagesBuild = input;
  try {
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    return await run(module);
  } finally {
    globalThis.__zeroPagesBuild = undefined;
  }
}

function routeEntry(route: { file: string; layouts: string[]; param: string | null }, notFound: boolean): string {
  const lines = [
    `import * as page from ${JSON.stringify(route.file)};`,
    ...route.layouts.map((layout, index) => `import * as layout${index} from ${JSON.stringify(layout)};`),
    `import { renderRoute } from ${JSON.stringify(path.join(here, `render${moduleExtension}`))};`,
    `export const pageModule = page;`,
    `export default () => renderRoute({ page, layouts: [${route.layouts.map((_, index) => `layout${index}`).join(", ")}], param: ${JSON.stringify(route.param)}, notFound: ${notFound} });`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 5. Assets

const sha = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

class Assets {
  readonly files = new Map<string, Uint8Array | string>();

  add(name: string, contents: Uint8Array | string): string {
    const existing = this.files.get(name);
    if (existing !== undefined && sha(existing) !== sha(contents)) throw new Error(`Two different assets are named ${name}.`);
    this.files.set(name, contents);
    return `assets/${name}`;
  }

  css(text: string): string {
    // File references inside CSS stay relative: the stylesheet and its files share assets/.
    const relative = text.split(`${ASSET_TOKEN}/`).join("./");
    return this.add(`page-${sha(relative).slice(0, 16)}.css`, relative);
  }
}

async function bundleIsland(root: string, file: string): Promise<{ code: string; texts: string[] } | PagesDiagnostic[]> {
  try {
    const result = await esbuild({
      entryPoints: [file],
      absWorkingDir: root,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      external: ["@wordpress/interactivity"],
      write: false,
      metafile: true,
      logLevel: "silent",
      tsconfigRaw: {},
    });
    return { code: result.outputFiles[0]!.text, texts: projectTexts(root, result.metafile) };
  } catch (failure) {
    const messages = (failure as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors ?? [];
    return messages.map((message) => {
      const diagnostic: PagesDiagnostic = { code: "island", severity: "error", message: message.text };
      diagnostic.loc = message.location ? { file: path.resolve(root, message.location.file), line: message.location.line, column: message.location.column + 1 } : { file, line: 1, column: 1 };
      return diagnostic;
    });
  }
}

// ---------------------------------------------------------------------------
// The build

function label(route: RouteFile): string {
  const last = route.segments.at(-1);
  if (last === undefined) return "Home";
  return last.split(/[-_.~]+/).filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

function staticTitle(metadata: MetadataOut[], fallback: string): string {
  const title = metadata.at(-1)?.title;
  return title !== undefined && !title.includes(TOKEN_START) ? title : fallback;
}

async function serialize(nodes: unknown[]): Promise<{ markup: string; diagnostics: PagesDiagnostic[] }> {
  const mapped = mapToBlocks(nodes as ContentNode[]);
  const mappedDiagnostics = mapped.diagnostics as PagesDiagnostic[];
  if (hasErrors(mappedDiagnostics)) return { markup: "", diagnostics: mappedDiagnostics };
  const serialized = await serializeBlocks(mapped.blocks as BlockNode[]);
  // Region blocks are this package's own, registered server-side; Blocks rightly cannot check them.
  const diagnostics = [...mappedDiagnostics, ...(serialized.diagnostics as PagesDiagnostic[])]
    .filter((d) => !(d.code === "unverified_block" && d.message.startsWith("zero-pages/")));
  return { markup: serialized.markup, diagnostics };
}

export async function buildPages(options: BuildOptions): Promise<BuildResult> {
  const project = path.resolve(options.project);
  const pagesDir = path.join(project, "pages");
  if (!(await exists(pagesDir))) return { ok: true, pages: false, diagnostics: [] };

  const loaded = await loadSchema(project);
  if (!("schema" in loaded)) return { ok: false, pages: true, diagnostics: [loaded] };
  const app = loaded;

  const found = await discover(pagesDir);
  const diagnostics: PagesDiagnostic[] = [...found.diagnostics];
  if (found.routes.length === 0) diagnostics.push(error("route_shape", "pages/ has no page.tsx.", pagesDir));
  if (hasErrors(diagnostics)) return { ok: false, pages: true, diagnostics };

  const scratch = path.join(tmpdir(), `zero-pages-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
  try {
    // Bundle and check everything before executing anything.
    type Unit = { route: RouteFile; notFound: boolean; bundle: Bundle; dir: string };
    const units: Unit[] = [];
    const entries: { route: RouteFile; notFound: boolean }[] = found.routes.map((route) => ({ route, notFound: false }));
    if (found.notFound !== null) {
      const rootLayouts = found.routes.find((route) => route.pattern === "/")?.layouts
        ?? (await exists(path.join(pagesDir, "layout.tsx")) ? [path.join(pagesDir, "layout.tsx")] : []);
      entries.push({ route: { pattern: "/404", param: null, file: found.notFound, layouts: rootLayouts.filter((file) => path.dirname(file) === pagesDir), segments: [] }, notFound: true });
    }
    const checked = new Set<string>();
    const textInputs = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      const dir = path.join(scratch, `r${index}`);
      await mkdir(dir);
      const bundle = await bundleRoute(project, routeEntry(entry.route, entry.notFound), dir);
      if (Array.isArray(bundle)) {
        diagnostics.push(...bundle);
        continue;
      }
      for (const file of bundle.texts) textInputs.add(file);
      for (const input of bundle.inputs) {
        if (checked.has(input)) continue;
        checked.add(input);
        diagnostics.push(...(await checkSource(input)));
      }
      units.push({ ...entry, bundle, dir });
    }
    if (hasErrors(diagnostics)) return { ok: false, pages: true, diagnostics };

    const staticRoutes = found.routes.filter((route) => route.param === null).map((route) => route.pattern);
    const base: BuildInput = { schema: app.schema, routed: [], actions: app.actions, staticRoutes };

    // Phase 1: evaluate item routes' declarations, so every route knows which rows have an href.
    const routed = new Map<string, RouteFile>();
    for (const unit of units.filter((u) => u.route.param !== null)) {
      try {
        const declared = await importRoute(unit.bundle.code, unit.dir, "declare", base, async (module) => (module.pageModule as { page?: { collection?: unknown } }).page?.collection);
        if (typeof declared !== "string") continue;
        const other = routed.get(declared);
        if (other !== undefined) {
          diagnostics.push(error("not_routable", `"${declared}" already has an item route at ${displayPattern(other)}; one item route per collection.`, unit.route.file));
        } else {
          routed.set(declared, unit.route);
        }
      } catch (failure) {
        diagnostics.push(failureDiagnostic(failure, unit.route.file, path.join(unit.dir, "route-declare.mjs"), unit.bundle.map, unit.dir, project));
      }
    }
    if (hasErrors(diagnostics)) return { ok: false, pages: true, diagnostics };

    // Phase 2: render, serialize and collect assets.
    const input: BuildInput = { ...base, routed: [...routed.keys()] };
    const assets = new Assets();
    const islands: Manifest["islands"] = {};
    const islandSources = new Map<string, string>();
    const reserved = reservedSiblings(found.routes);
    const routes: ManifestRoute[] = [];
    let notFound: ManifestRoute | null = null;
    const ids = new Map<string, string>();
    for (const unit of units) {
      let rendered: Rendered;
      try {
        rendered = await importRoute(unit.bundle.code, unit.dir, "render", input, async (module) => (module.default as () => Promise<Rendered>)());
      } catch (failure) {
        diagnostics.push(failureDiagnostic(failure, unit.route.file, path.join(unit.dir, "route-render.mjs"), unit.bundle.map, unit.dir, project));
        continue;
      }
      const id = unit.notFound ? "zero:not-found" : routeId(unit.route.pattern, rendered.explicitId);
      const previous = ids.get(id);
      if (previous !== undefined) {
        diagnostics.push(error("route_id", `Route ID ${id} is also used by ${previous}.`, unit.route.file));
        continue;
      }
      ids.set(id, unit.route.file);
      const key = routeKey(app.app, id);
      const document = await serialize(rendered.document);
      diagnostics.push(...document.diagnostics);
      const body = unit.route.param === null && !unit.notFound ? await serialize(rendered.body) : null;
      if (body !== null) diagnostics.push(...body.diagnostics);
      if (hasErrors(document.diagnostics) || (body !== null && hasErrors(body.diagnostics))) continue;

      const css = unit.bundle.css === null || unit.bundle.css.trim() === "" ? [] : [assets.css(unit.bundle.css)];
      for (const file of unit.bundle.files) assets.add(path.basename(file.path), file.contents);
      const modules: string[] = [];
      for (const region of Object.values(rendered.regions)) {
        if (region.kind !== "island") continue;
        const source = path.resolve(project, path.dirname(region.from), region.module);
        if (!source.startsWith(`${project}${path.sep}`)) {
          diagnostics.push(error("island", `Island module ${region.module} is outside the project.`, path.resolve(project, region.from)));
          continue;
        }
        const previousSource = islandSources.get(region.namespace);
        if (previousSource !== undefined && previousSource !== source) {
          diagnostics.push(error("island", `Island namespace ${region.namespace} uses different modules; each namespace must have one module.`, path.resolve(project, region.from)));
          continue;
        }
        const existing = islands[region.namespace];
        if (existing === undefined) {
          const bundled = await bundleIsland(project, source);
          if (Array.isArray(bundled)) {
            diagnostics.push(...bundled);
            continue;
          }
          for (const text of bundled.texts) textInputs.add(text);
          const file = assets.add(`island-${sha(bundled.code).slice(0, 16)}.js`, bundled.code);
          islands[region.namespace] = { namespace: region.namespace, file, actions: [...region.actions] };
          islandSources.set(region.namespace, source);
        } else {
          const merged = new Set([...existing.actions, ...region.actions]);
          existing.actions = [...merged];
        }
        modules.push(region.namespace);
        region.module = islands[region.namespace]!.file;
      }
      const collection = rendered.collection;
      const entry: ManifestRoute = {
        id,
        key,
        pattern: unit.route.pattern,
        param: unit.route.param,
        source: path.relative(project, unit.route.file),
        collection,
        slugColumn: collection === null ? null : app.schema[collection]!.slug,
        postType: collection === null ? null : app.postTypes[collection] ?? null,
        title: staticTitle(rendered.metadata, label(unit.route)),
        template: `templates/r${key}.html`,
        body: body === null ? null : `content/r${key}.html`,
        bodyDigest: body === null ? null : sha(body.markup),
        css,
        modules: [...new Set(modules)],
        metadata: rendered.metadata,
        tokens: rendered.tokens,
        regions: rendered.regions,
        queries: rendered.queries,
        reserved: reserved.get(unit.route) ?? [],
      };
      (entry as ManifestRoute & { markup?: { document: string; body: string | null } }).markup = { document: document.markup, body: body?.markup ?? null };
      if (unit.notFound) notFound = entry;
      else routes.push(entry);
    }
    if (hasErrors(diagnostics)) return { ok: false, pages: true, diagnostics };

    // Keys are hashes; a collision would make two routes share files.
    const keys = new Set<string>();
    for (const route of [...routes, ...(notFound === null ? [] : [notFound])]) {
      if (keys.has(route.key)) return { ok: false, pages: true, diagnostics: [error("route_id", `Route key collision for ${route.id}.`)] };
      keys.add(route.key);
    }

    const manifest: Manifest = { version: 1, app: app.app, digest: "", routes, notFound, islands };
    const files = pluginFiles(manifest, assets);
    const inputs: Record<string, string> = {};
    for (const file of [...textInputs].sort()) inputs[path.relative(project, file).split(path.sep).join("/")] = sha(await readFile(file));
    const artifact: Artifact = {
      format: "zero.pages.v1",
      app: app.app,
      schema: app,
      inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => (a < b ? -1 : 1))),
      manifest: `${JSON.stringify(manifest, null, 2)}\n`,
      files: Object.fromEntries([...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, contents]) => [name, Buffer.from(contents).toString("base64")])),
    };
    const text = `${JSON.stringify(artifact, null, 2)}\n`;
    await mkdir(path.join(project, "zero"), { recursive: true });
    await writeFile(path.join(project, ARTIFACT_FILE), text);
    const plugin = await installPlugin(options.out, text);
    return { ok: true, pages: true, diagnostics, plugin, manifest, artifact: text };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Static strings in the markup must not carry stray token characters; only the build's own tokens may. */
function assertTokens(markup: string, route: ManifestRoute): void {
  const stray = markup.replace(/\u{E000}[a-z][a-z0-9]*\u{E001}/gu, "");
  if (stray.includes(TOKEN_START) || stray.includes(TOKEN_END)) {
    throw new Error(`${route.source}: text contains reserved private-use characters U+E000/U+E001.`);
  }
}

/** Templates, bodies and assets by plugin path; fills in the manifest digest. */
function pluginFiles(manifest: Manifest, assets: Assets): Map<string, string | Uint8Array> {
  const files = new Map<string, string | Uint8Array>();
  const hashes: string[] = [];
  for (const route of [...manifest.routes, ...(manifest.notFound === null ? [] : [manifest.notFound])]) {
    const withMarkup = route as ManifestRoute & { markup?: { document: string; body: string | null } };
    const markup = withMarkup.markup!;
    delete withMarkup.markup;
    assertTokens(markup.document, route);
    files.set(route.template, markup.document);
    hashes.push(sha(markup.document));
    if (route.body !== null && markup.body !== null) {
      assertTokens(markup.body, route);
      files.set(route.body, markup.body);
    }
  }
  for (const [name, contents] of [...assets.files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    files.set(`assets/${name}`, contents);
    hashes.push(`${name}:${sha(contents)}`);
  }
  manifest.digest = sha(JSON.stringify({ ...manifest, digest: "" }) + hashes.join("\n"));
  return files;
}

/**
 * Write `plugins/zero-pages-<app>/` from an artifact's text. Zero's host
 * compiler writes the same bytes from the same artifact (src/pages.rs).
 */
export async function installPlugin(out: string, artifactText: string): Promise<string> {
  const artifact = JSON.parse(artifactText) as Artifact;
  const slug = `zero-pages-${artifact.app}`;
  const plugins = path.join(path.resolve(out), "plugins");
  await mkdir(plugins, { recursive: true });
  const target = path.join(plugins, slug);
  const stage = path.join(plugins, `.${slug}-${randomUUID()}`);
  await mkdir(stage);
  try {
    for (const directory of ["templates", "content", "assets"]) await mkdir(path.join(stage, directory));
    await cp(await wpRuntime(), path.join(stage, "zero-pages"), { recursive: true });
    for (const [name, contents] of Object.entries(artifact.files)) await writeFile(path.join(stage, name), Buffer.from(contents, "base64"));
    await writeFile(path.join(stage, "manifest.json"), artifact.manifest);
    await writeFile(path.join(stage, `${slug}.php`), bootstrap(artifact.app));
    const backup = `${stage}.previous`;
    const had = await exists(target);
    if (had) await rename(target, backup);
    try {
      await rename(stage, target);
    } catch (failure) {
      if (had) await rename(backup, target);
      throw failure;
    }
    if (had) await rm(backup, { recursive: true, force: true });
    return target;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function bootstrap(app: string): string {
  const label = app.replace(/[^a-z0-9-]/g, "");
  return `<?php
/**
 * Plugin Name: ${label} pages (Zero)
 * Description: TSX pages compiled by @spacefast/zero-pages: routes, layouts and regions rendered by WordPress.
 * Requires at least: 7.1
 * Requires PHP: 8.2
 * Requires Plugins: zero-runtime, zero-app-${label}
 * License: GPL-2.0-or-later
 */
declare(strict_types=1);
defined('ABSPATH') || exit;
require_once __DIR__ . '/zero-pages/bootstrap.php';
\\Zero\\Pages\\Plugin::boot(__FILE__, ${JSON.stringify(label).replace(/"/g, "'")});
`;
}
