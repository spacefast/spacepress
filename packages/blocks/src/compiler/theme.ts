/**
 * Build a block theme from a directory of TSX.
 *
 * `theme.config.ts` is executed for the header and `theme.json`; every file
 * under `templates/`, `parts/`, `patterns/` and `styles/` is executed, mapped
 * and serialized the way `compileContent` does one file; the results are
 * checked against each other (a part a template names must exist, a pattern
 * slug must be unique, a preset a block names must be defined) and against
 * the official `theme.json` schema; then everything is written at once, or
 * nothing is. Output is byte-stable for the same input.
 */
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatDiagnostic, hasErrors, nearest, type Diagnostic } from "../diagnostics.ts";
import { toContentNodes } from "../jsx-runtime.ts";
import { mapToBlocks } from "../mapping.ts";
import type { BlockNode, ContentNode, SourceLocation } from "../nodes.ts";
import { hasKind, isTheme, type PartMeta, type PatternMeta, type StyleVariation, type TemplateMeta, type Theme, type ThemeConfig } from "../theme/define.ts";
import { classifyTemplate, defaultPartArea, partTagName, TEMPLATE_PART_AREAS, TEMPLATE_SLUG, type TemplatePartArea } from "../theme/hierarchy.ts";
import { defaultExportMissing, withModule } from "./module.ts";
import { headerValueProblem, renderPatternFile } from "./pattern-file.ts";
import { checkBlockPresets, checkStylePresets, presetTable } from "./presets.ts";
import { serializeBlocks } from "./serialize.ts";
import { THEME_JSON_SCHEMA_URL, validateThemeJson } from "./theme-json.ts";
import { zip } from "./zip.ts";

export interface ThemeFile {
  /** Path inside the theme directory, forward slashes. */
  path: string;
  data: Uint8Array;
}

export interface ThemeBuild {
  /** The theme's slug: its directory name and text domain. Empty when the config could not be read. */
  slug: string;
  /** Every file the theme consists of, sorted by path. Empty when any diagnostic is an error. */
  files: ThemeFile[];
  diagnostics: Diagnostic[];
}

const SOURCE_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js", ".mjs"]);

interface SourceFile {
  /** `templates/single` */
  slug: string;
  file: string;
}

async function listSources(dir: string, folder: string): Promise<SourceFile[]> {
  const root = path.join(dir, folder);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  return entries
    .filter((name) => SOURCE_EXTENSIONS.has(path.extname(name)) && !name.endsWith(".d.ts"))
    .sort()
    .map((name) => ({ slug: name.slice(0, -path.extname(name).length), file: path.join(root, name) }));
}

function at(file: string): SourceLocation {
  return { file, line: 1, column: 1 };
}

function error(code: Diagnostic["code"], message: string, loc: SourceLocation | undefined, hint?: string): Diagnostic {
  const d: Diagnostic = { code, severity: "error", message };
  if (hint !== undefined) d.hint = hint;
  if (loc) d.loc = loc;
  return d;
}

/**
 * Build the theme in memory. Nothing touches the disk except reading the
 * sources and copying `assets/`; `writeTheme` writes the result.
 */
export async function buildTheme(dir: string): Promise<ThemeBuild> {
  const root = path.resolve(dir);
  const diagnostics: Diagnostic[] = [];
  const configFile = await findConfig(root);
  if (configFile === null) {
    return { slug: "", files: [], diagnostics: [error("theme_config_invalid", "theme.config.ts not found.", at(path.join(root, "theme.config.ts")), "Create theme.config.ts with `export default defineTheme({ name, slug })`.")] };
  }
  const theme = await loadConfig(configFile, diagnostics);
  if (theme === null) return { slug: "", files: [], diagnostics };
  const config = theme.config;
  const slug = config.slug;

  // Every authored file, executed, mapped and checked, in a fixed order.
  const sources = {
    templates: await listSources(root, "templates"),
    parts: await listSources(root, "parts"),
    patterns: await listSources(root, "patterns"),
    styles: await listSources(root, "styles"),
  };
  const units = new Map<string, Unit>();
  for (const [folder, list] of Object.entries(sources) as [keyof typeof sources, SourceFile[]][]) {
    for (const source of list) {
      if (!TEMPLATE_SLUG.test(source.slug)) {
        diagnostics.push(error("unknown_template", `${folder}/${path.basename(source.file)}: "${source.slug}" is not a name WordPress can resolve (lowercase letters, digits, dashes, dots and underscores).`, at(source.file), "Rename the file."));
        continue;
      }
      const unit = await executeUnit(folder, source, diagnostics);
      if (unit) units.set(`${folder}/${source.slug}`, unit);
    }
  }

  // Templates: hierarchy or declared.
  const customTemplates = new Map<string, { name: string; title: string; postTypes?: string[] | undefined }>();
  for (const declared of config.customTemplates ?? []) customTemplates.set(declared.name, { name: declared.name, title: declared.title, ...(declared.postTypes ? { postTypes: [...declared.postTypes] } : {}) });
  const templateSlugs = new Set(sources.templates.map((s) => s.slug));
  if (!templateSlugs.has("index")) diagnostics.push(error("index_template_missing", "templates/index.tsx is required: WordPress needs an index template to treat a directory as a block theme.", at(path.join(root, "templates", "index.tsx")), "Add templates/index.tsx."));
  for (const declared of config.customTemplates ?? []) {
    if (!templateSlugs.has(declared.name)) diagnostics.push(error("declared_file_missing", `customTemplates declares "${declared.name}", but templates/${declared.name}.tsx does not exist.`, at(configFile), "Add the file, or remove the declaration."));
  }
  for (const source of sources.templates) {
    const unit = units.get(`templates/${source.slug}`);
    if (!unit) continue;
    const meta = unit.meta;
    if (hasKind(meta, "template")) {
      const template = meta as TemplateMeta;
      customTemplates.set(source.slug, { name: source.slug, title: template.title, ...(template.postTypes ? { postTypes: [...template.postTypes] } : {}) });
    } else if (meta !== undefined) {
      diagnostics.push(error("theme_config_invalid", `templates/${source.slug}: \`meta\` must come from defineTemplate().`, at(source.file)));
    } else if (classifyTemplate(source.slug).kind === "custom" && !customTemplates.has(source.slug)) {
      diagnostics.push(error("unknown_template", `templates/${source.slug}.tsx is not a name in WordPress's template hierarchy.`, at(source.file), `Rename it to a hierarchy slug (index, single, page, archive, single-<post_type>, page-<slug>, …) or export \`meta = defineTemplate({ title: "…" })\` to make it a custom template.`));
    }
  }

  // Parts: area and title.
  const partDeclarations = new Map<string, { name: string; title: string; area: TemplatePartArea }>();
  for (const declared of config.templateParts ?? []) {
    const area = normalizeArea(declared.area, `templateParts "${declared.name}"`, at(configFile), diagnostics);
    partDeclarations.set(declared.name, { name: declared.name, title: declared.title ?? titleOf(declared.name), area });
    if (!sources.parts.some((s) => s.slug === declared.name)) diagnostics.push(error("declared_file_missing", `templateParts declares "${declared.name}", but parts/${declared.name}.tsx does not exist.`, at(configFile), "Add the file, or remove the declaration."));
  }
  for (const source of sources.parts) {
    const unit = units.get(`parts/${source.slug}`);
    if (!unit) continue;
    const declared = partDeclarations.get(source.slug);
    if (hasKind(unit.meta, "part")) {
      const part = unit.meta as PartMeta;
      const area = part.area === undefined ? (declared?.area ?? defaultPartArea(source.slug)) : normalizeArea(part.area, `parts/${source.slug}`, at(source.file), diagnostics);
      partDeclarations.set(source.slug, { name: source.slug, title: part.title ?? declared?.title ?? titleOf(source.slug), area });
    } else if (unit.meta !== undefined) {
      diagnostics.push(error("theme_config_invalid", `parts/${source.slug}: \`meta\` must come from definePart().`, at(source.file)));
    } else if (!declared) {
      partDeclarations.set(source.slug, { name: source.slug, title: titleOf(source.slug), area: defaultPartArea(source.slug) });
    }
  }

  // Patterns: header and unique slug.
  const patternSlugs = new Map<string, SourceFile>();
  const patternMeta = new Map<string, { meta: PatternMeta; slug: string }>();
  for (const source of sources.patterns) {
    const unit = units.get(`patterns/${source.slug}`);
    if (!unit) continue;
    if (!hasKind(unit.meta, "pattern")) {
      diagnostics.push(error("theme_config_invalid", `patterns/${source.slug}: export \`meta = definePattern({ title: "…" })\`; WordPress needs a title to register a pattern.`, at(source.file)));
      continue;
    }
    const meta = unit.meta as PatternMeta;
    const patternSlug = meta.slug ?? `${slug}/${source.slug}`;
    if (!/^[A-Za-z0-9/_-]+$/.test(patternSlug)) {
      diagnostics.push(error("theme_config_invalid", `patterns/${source.slug}: slug "${patternSlug}" is not one WordPress accepts (letters, digits, "/", "_" and "-").`, at(source.file)));
      continue;
    }
    const earlier = patternSlugs.get(patternSlug);
    if (earlier) {
      diagnostics.push(error("duplicate_slug", `patterns/${source.slug} and patterns/${earlier.slug} both have the slug "${patternSlug}".`, at(source.file), "Give one of them a different slug in definePattern()."));
      continue;
    }
    for (const [field, value] of [["title", meta.title], ["description", meta.description], ["slug", patternSlug]] as const) {
      const problem = typeof value === "string" ? headerValueProblem(value) : null;
      if (problem) diagnostics.push(error("theme_config_invalid", `patterns/${source.slug}: ${field} ${problem}.`, at(source.file)));
    }
    patternSlugs.set(patternSlug, source);
    patternMeta.set(source.slug, { meta, slug: patternSlug });
  }

  // Cross references inside the block trees: parts, patterns, query mode, presets.
  const settings = (config.settings ?? {}) as Record<string, unknown>;
  const presets = presetTable(settings);
  const referencedParts = new Set<string>();
  const knownPatterns = new Set([...patternSlugs.keys(), ...(config.externalPatterns ?? [])]);
  for (const [key, unit] of units) {
    if (key.startsWith("styles/")) continue;
    walkBlocks(unit.blocks, (block) => {
      if (block.blockName === "core/template-part") {
        const partSlug = block.attrs.slug;
        if (typeof partSlug !== "string" || !partDeclarations.has(partSlug)) {
          diagnostics.push(error("unknown_template_part", `<TemplatePart slug="${String(partSlug)}"> names a part that is not in parts/.`, block.loc, nearest(String(partSlug), partDeclarations.keys()) ? `Did you mean "${nearest(String(partSlug), partDeclarations.keys())}"?` : "Add parts/<slug>.tsx."));
        } else {
          referencedParts.add(partSlug);
          const declared = partDeclarations.get(partSlug)!;
          if (block.attrs.tagName === undefined) block.attrs.tagName = partTagName(declared.area);
          if (block.attrs.area === undefined) block.attrs.area = declared.area;
        }
      } else if (block.blockName === "core/pattern") {
        const ref = block.attrs.slug;
        if (typeof ref !== "string" || !knownPatterns.has(ref)) {
          const candidate = nearest(String(ref), knownPatterns);
          diagnostics.push(error("unknown_pattern", `<Pattern slug="${String(ref)}"> names a pattern this theme does not define.`, block.loc, candidate ? `Did you mean "${candidate}"?` : `Add patterns/<name>.tsx, or list a plugin's pattern under externalPatterns in theme.config.ts.`));
        }
      } else if (block.blockName === "core/query" && typeof block.attrs["zero-blocks:query-mode"] === "string") {
        const mode = block.attrs["zero-blocks:query-mode"];
        delete block.attrs["zero-blocks:query-mode"];
        diagnostics.push(error("query_mode_required", mode === "both" ? "<QueryLoop> has both `inherit` and a `query`; a loop either inherits the page's query or runs its own." : "<QueryLoop> needs `inherit` or a `query`.", block.loc, 'Write <QueryLoop inherit> or <QueryLoop query={{ postType: "post", perPage: 6 }}>.'));
      }
    });
    checkBlockPresets(unit.blocks, presets, diagnostics);
  }
  for (const name of partDeclarations.keys()) {
    if (!referencedParts.has(name)) diagnostics.push({ code: "unused_part", severity: "warning", message: `parts/${name} is not referenced by any template, part or pattern.`, loc: at(sources.parts.find((s) => s.slug === name)?.file ?? configFile) });
  }

  // theme.json: derived entries merged with declarations, then the schema.
  const themeJson: Record<string, unknown> = { $schema: THEME_JSON_SCHEMA_URL, version: 3 };
  if (config.settings !== undefined) themeJson.settings = config.settings;
  if (config.styles !== undefined) themeJson.styles = config.styles;
  const customList = [...customTemplates.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  if (customList.length > 0) themeJson.customTemplates = customList;
  const partList = [...partDeclarations.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  if (partList.length > 0) themeJson.templateParts = partList;
  if (config.patterns !== undefined) themeJson.patterns = config.patterns;
  checkStylePresets(config.styles, presets, "styles", at(configFile), diagnostics);
  for (const problem of validateThemeJson(themeJson)) diagnostics.push(error("theme_json_invalid", `theme.json${problem.pointer || "/"} ${problem.message}.`, at(configFile)));

  // Style variations: same document shape, same checks, their own presets layered on the theme's.
  const variationFiles: ThemeFile[] = [];
  for (const source of sources.styles) {
    const unit = units.get(`styles/${source.slug}`);
    if (!unit) continue;
    if (!hasKind(unit.meta, "style-variation")) {
      diagnostics.push(error("theme_config_invalid", `styles/${source.slug}: the default export must come from defineStyleVariation().`, at(source.file)));
      continue;
    }
    const variation = unit.meta as StyleVariation;
    const document: Record<string, unknown> = { $schema: THEME_JSON_SCHEMA_URL, version: 3, title: variation.title };
    if (variation.settings !== undefined) document.settings = variation.settings;
    if (variation.styles !== undefined) document.styles = variation.styles;
    const layered = presetTable(settings, variation.settings as Record<string, unknown> | undefined);
    checkStylePresets(variation.styles, layered, "styles", at(source.file), diagnostics);
    for (const problem of validateThemeJson(document)) diagnostics.push(error("theme_json_invalid", `styles/${source.slug}.json${problem.pointer || "/"} ${problem.message}.`, at(source.file)));
    variationFiles.push({ path: `styles/${source.slug}.json`, data: utf8(`${JSON.stringify(document, null, 2)}\n`) });
  }

  if (hasErrors(diagnostics)) return { slug, files: [], diagnostics };

  // Serialize every block tree with the one registry.
  const files: ThemeFile[] = [];
  for (const [key, unit] of units) {
    if (key.startsWith("styles/")) continue;
    const serialized = await serializeBlocks(unit.blocks);
    diagnostics.push(...serialized.diagnostics);
    unit.markup = serialized.markup;
  }
  if (hasErrors(diagnostics)) return { slug, files: [], diagnostics };

  for (const source of sources.templates) {
    const unit = units.get(`templates/${source.slug}`);
    if (unit) files.push({ path: `templates/${source.slug}.html`, data: utf8(withNewline(unit.markup)) });
  }
  for (const source of sources.parts) {
    const unit = units.get(`parts/${source.slug}`);
    if (unit) files.push({ path: `parts/${source.slug}.html`, data: utf8(withNewline(unit.markup)) });
  }
  for (const source of sources.patterns) {
    const unit = units.get(`patterns/${source.slug}`);
    const entry = patternMeta.get(source.slug);
    if (unit && entry) files.push({ path: `patterns/${source.slug}.php`, data: utf8(renderPatternFile(entry.meta, entry.slug, unit.markup)) });
  }
  files.push(...variationFiles);
  files.push({ path: "theme.json", data: utf8(`${JSON.stringify(themeJson, null, 2)}\n`) });
  files.push({ path: "style.css", data: utf8(styleCss(config)) });
  files.push({ path: "readme.txt", data: utf8(readmeTxt(config)) });
  files.push(...(await collectAssets(root)));
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { slug, files, diagnostics };
}

interface Unit {
  source: SourceFile;
  meta: unknown;
  blocks: BlockNode[];
  markup: string;
}

/** Execute one file under templates/, parts/, patterns/ or styles/ and keep what the folder needs. */
async function executeUnit(folder: "templates" | "parts" | "patterns" | "styles", source: SourceFile, diagnostics: Diagnostic[]): Promise<Unit | null> {
  const outcome = await withModule(source.file, (loaded): { meta: unknown; nodes: ContentNode[] } | Diagnostic => {
    const exported = loaded.namespace.default;
    if (folder === "styles") {
      if (!hasKind(exported, "style-variation")) return error("theme_config_invalid", `styles/${source.slug}: the default export must come from defineStyleVariation().`, at(source.file));
      return { meta: exported, nodes: [] };
    }
    if (typeof exported !== "function") return defaultExportMissing(loaded.entry);
    return { meta: loaded.namespace.meta, nodes: renderNodes(exported as () => unknown, loaded.entry) };
  });
  if (!outcome.ok) {
    diagnostics.push(...outcome.diagnostics);
    return null;
  }
  if ("code" in outcome.value) {
    diagnostics.push(outcome.value);
    return null;
  }
  const mapped = mapToBlocks(outcome.value.nodes);
  diagnostics.push(...mapped.diagnostics);
  return { source, meta: outcome.value.meta, blocks: mapped.blocks, markup: "" };
}

function renderNodes(render: () => unknown, entry: string): ContentNode[] {
  return toContentNodes(render(), at(entry));
}

async function findConfig(root: string): Promise<string | null> {
  for (const name of ["theme.config.ts", "theme.config.tsx", "theme.config.js", "theme.config.mjs"]) {
    const file = path.join(root, name);
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      /* next */
    }
  }
  return null;
}

async function loadConfig(configFile: string, diagnostics: Diagnostic[]): Promise<Theme | null> {
  const outcome = await withModule(configFile, (loaded): Theme | Diagnostic => {
    const exported = loaded.namespace.default;
    if (!isTheme(exported)) return error("theme_config_invalid", "theme.config.ts must default-export defineTheme({ … }).", at(loaded.entry));
    const config = exported.config as ThemeConfig;
    if (typeof config.name !== "string" || config.name.trim() === "") return error("theme_config_invalid", "defineTheme() needs a `name` (the Theme Name header).", at(loaded.entry));
    if (typeof config.slug !== "string" || !/^[a-z][a-z0-9-]*$/.test(config.slug)) return error("theme_config_invalid", `defineTheme() needs a \`slug\` of lowercase letters, digits and dashes; got ${JSON.stringify(config.slug)}.`, at(loaded.entry), "The slug is the theme's directory name and text domain.");
    for (const [field, value] of Object.entries(config)) {
      if (typeof value === "string" && headerValueProblem(value) && ["name", "version", "description", "author", "authorUri", "themeUri", "license", "licenseUri", "requiresWp", "requiresPhp", "testedUpTo"].includes(field)) {
        return error("theme_config_invalid", `defineTheme() ${field} ${headerValueProblem(value)}; style.css headers are one line each.`, at(loaded.entry));
      }
    }
    return exported;
  });
  if (!outcome.ok) {
    diagnostics.push(...outcome.diagnostics);
    return null;
  }
  if ("code" in outcome.value) {
    diagnostics.push(outcome.value);
    return null;
  }
  return outcome.value;
}

function normalizeArea(area: string | undefined, what: string, loc: SourceLocation, diagnostics: Diagnostic[]): TemplatePartArea {
  if (area === undefined) return "uncategorized";
  if ((TEMPLATE_PART_AREAS as readonly string[]).includes(area)) return area as TemplatePartArea;
  diagnostics.push(error("theme_config_invalid", `${what}: "${area}" is not a template part area WordPress 7.1 knows; it would register as "uncategorized" with a warning.`, loc, `Use one of ${TEMPLATE_PART_AREAS.map((a) => `"${a}"`).join(", ")}.`));
  return "uncategorized";
}

function titleOf(slug: string): string {
  return slug.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function walkBlocks(nodes: readonly ContentNode[], visit: (block: BlockNode) => void): void {
  for (const node of nodes) {
    if (node.kind === "block") {
      visit(node);
      walkBlocks(node.inner, visit);
    } else if (node.kind === "element") walkBlocks(node.children, visit);
  }
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function withNewline(markup: string): string {
  return markup === "" || markup.endsWith("\n") ? markup : `${markup}\n`;
}

/** The `style.css` header, and nothing else: a block theme's styles live in theme.json. */
export function styleCss(config: ThemeConfig): string {
  const fields: [string, string | undefined][] = [
    ["Theme Name", config.name],
    ["Theme URI", config.themeUri],
    ["Author", config.author],
    ["Author URI", config.authorUri],
    ["Description", config.description],
    ["Requires at least", config.requiresWp ?? "7.1"],
    ["Tested up to", config.testedUpTo],
    ["Requires PHP", config.requiresPhp ?? "8.2"],
    ["Version", config.version ?? "0.1.0"],
    ["License", config.license ?? "GPL-2.0-or-later"],
    ["License URI", config.licenseUri ?? (config.license === undefined ? "https://www.gnu.org/licenses/gpl-2.0.html" : undefined)],
    ["Text Domain", config.slug],
    ["Tags", config.tags && config.tags.length > 0 ? config.tags.join(", ") : undefined],
  ];
  return `/*\n${fields.flatMap(([name, value]) => (value === undefined || value === "" ? [] : [`${name}: ${value}`])).join("\n")}\n*/\n`;
}

function readmeTxt(config: ThemeConfig): string {
  const lines = [`=== ${config.name} ===`, `Requires at least: ${config.requiresWp ?? "7.1"}`, `Requires PHP: ${config.requiresPhp ?? "8.2"}`, `Stable tag: ${config.version ?? "0.1.0"}`, `License: ${config.license ?? "GPL-2.0-or-later"}`, ""];
  if (config.description) lines.push(config.description, "");
  lines.push("== Description ==", "", `A block theme built from TSX with @spacefast/zero-blocks. Templates, parts, patterns and theme.json are generated; edit the sources, not these files.`, "");
  return lines.join("\n");
}

async function collectAssets(root: string): Promise<ThemeFile[]> {
  const out: ThemeFile[] = [];
  const assets = path.join(root, "assets");
  const walk = async (dir: string, prefix: string) => {
    let entries: string[];
    try {
      entries = (await readdir(dir)).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const file = path.join(dir, name);
      const info = await stat(file);
      if (info.isDirectory()) await walk(file, `${prefix}${name}/`);
      else if (info.isFile()) out.push({ path: `${prefix}${name}`, data: new Uint8Array(await readFile(file)) });
    }
  };
  await walk(assets, "assets/");
  // screenshot.png is read from the theme root by WordPress; an author keeps it beside theme.config.ts.
  for (const name of ["screenshot.png", "screenshot.jpg"]) {
    try {
      out.push({ path: name, data: new Uint8Array(await readFile(path.join(root, name))) });
      break;
    } catch {
      /* none */
    }
  }
  return out;
}

export interface WriteOptions {
  /** The directory that receives `<slug>/` (and `<slug>.zip`). */
  out: string;
  zip?: boolean | undefined;
}

/**
 * Write a successful build: stage every file beside the destination, then
 * replace `<out>/<slug>` in one rename, so a failed or interrupted write
 * never leaves a half-written theme where a whole one was.
 */
export async function writeTheme(build: ThemeBuild, options: WriteOptions): Promise<{ dir: string; zip?: string }> {
  if (hasErrors(build.diagnostics) || build.files.length === 0) throw new Error("writeTheme: nothing to write; the build has errors");
  const out = path.resolve(options.out);
  await mkdir(out, { recursive: true });
  const destination = path.join(out, build.slug);
  const staging = await mkdtemp(path.join(out, `.${build.slug}-`));
  try {
    for (const file of build.files) {
      const target = path.join(staging, ...file.path.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.data);
    }
    const previous = `${destination}.previous-${process.pid}`;
    let hadPrevious = false;
    try {
      await rename(destination, previous);
      hadPrevious = true;
    } catch {
      /* nothing there yet */
    }
    await rename(staging, destination);
    if (hadPrevious) await rm(previous, { recursive: true, force: true });
  } catch (failure) {
    await rm(staging, { recursive: true, force: true });
    throw failure;
  }
  const result: { dir: string; zip?: string } = { dir: destination };
  if (options.zip) {
    const archive = path.join(out, `${build.slug}.zip`);
    await writeFile(archive, zip(build.files.map((file) => ({ name: `${build.slug}/${file.path}`, data: file.data }))));
    result.zip = archive;
  }
  return result;
}

/** `zero-blocks check`: the diagnostics a build would produce, formatted, without writing. */
export function formatThemeDiagnostics(build: ThemeBuild, relativeTo: string): string[] {
  return build.diagnostics.map((d) => formatDiagnostic(d, relativeTo));
}

