/**
 * Preset slugs a theme may reference: its own, from `settings`, plus
 * WordPress 7.1's defaults unless the theme turned those off. Used for the
 * `var:preset|…` references in styles and for the preset-slug attributes
 * blocks carry (`backgroundColor`, `fontSize`, …).
 */
import type { BlockNode, ContentNode, SourceLocation } from "../nodes.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { nearest } from "../diagnostics.ts";

export type PresetKind = "color" | "gradient" | "duotone" | "font-size" | "font-family" | "spacing" | "shadow" | "aspect-ratio";

/** WordPress 7.1's own presets (`WP_Theme_JSON_Resolver::get_core_data()`), by kind. */
export const CORE_PRESETS: Record<PresetKind, readonly string[]> = {
  color: ["black", "cyan-bluish-gray", "white", "pale-pink", "vivid-red", "luminous-vivid-orange", "luminous-vivid-amber", "light-green-cyan", "vivid-green-cyan", "pale-cyan-blue", "vivid-cyan-blue", "vivid-purple"],
  gradient: ["vivid-cyan-blue-to-vivid-purple", "light-green-cyan-to-vivid-green-cyan", "luminous-vivid-amber-to-luminous-vivid-orange", "luminous-vivid-orange-to-vivid-red", "very-light-gray-to-cyan-bluish-gray", "cool-to-warm-spectrum", "blush-light-purple", "blush-bordeaux", "luminous-dusk", "pale-ocean", "electric-grass", "midnight"],
  duotone: ["dark-grayscale", "grayscale", "purple-yellow", "blue-red", "midnight", "magenta-yellow", "purple-green", "blue-orange"],
  "font-size": ["small", "medium", "large", "x-large"],
  "font-family": [],
  spacing: ["20", "30", "40", "50", "60", "70", "80"],
  shadow: ["natural", "deep", "sharp", "outlined", "crisp"],
  "aspect-ratio": ["square", "4-3", "3-4", "3-2", "2-3", "16-9", "9-16"],
};

/** Which `settings` flag turns the defaults of a kind off (`defaultPalette: false`, …). */
const DEFAULT_FLAGS: Record<PresetKind, { section: string; flag: string } | null> = {
  color: { section: "color", flag: "defaultPalette" },
  gradient: { section: "color", flag: "defaultGradients" },
  duotone: { section: "color", flag: "defaultDuotone" },
  "font-size": { section: "typography", flag: "defaultFontSizes" },
  "font-family": null,
  spacing: { section: "spacing", flag: "defaultSpacingSizes" },
  shadow: { section: "shadow", flag: "defaultPresets" },
  "aspect-ratio": { section: "dimensions", flag: "defaultAspectRatios" },
};

/** Where in `settings` each kind's own presets live. */
const OWN_LISTS: Record<PresetKind, { section: string; list: string }> = {
  color: { section: "color", list: "palette" },
  gradient: { section: "color", list: "gradients" },
  duotone: { section: "color", list: "duotone" },
  "font-size": { section: "typography", list: "fontSizes" },
  "font-family": { section: "typography", list: "fontFamilies" },
  spacing: { section: "spacing", list: "spacingSizes" },
  shadow: { section: "shadow", list: "presets" },
  "aspect-ratio": { section: "dimensions", list: "aspectRatios" },
};

/** The slugs available at the root, plus the extra ones each block defines for itself (`settings.blocks["core/button"].color.palette`). */
export interface PresetTable {
  root: Record<PresetKind, Set<string>>;
  blocks: Map<string, Partial<Record<PresetKind, Set<string>>>>;
}

function slugs(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => (typeof (entry as { slug?: unknown } | null)?.slug === "string" ? [(entry as { slug: string }).slug] : []));
}

/**
 * The spacing slugs WordPress generates from `spacingScale` (`WP_Theme_JSON::compute_spacing_sizes`):
 * `50` is the medium step, the steps below count down from `40` and the steps above up from `60`,
 * with the extra step of an even count going above. `steps: 0` turns generation off.
 */
export function spacingScaleSlugs(scale: unknown): string[] {
  const s = scale as { steps?: unknown; mediumStep?: unknown; unit?: unknown; operator?: unknown; increment?: unknown } | undefined;
  if (!s || typeof s.steps !== "number" || typeof s.mediumStep !== "number" || typeof s.unit !== "string" || (s.operator !== "+" && s.operator !== "*") || typeof s.increment !== "number") return [];
  if (s.steps <= 0) return [];
  const midpoint = Math.round(s.steps / 2);
  const below = s.steps > 1 ? Math.min(midpoint - 1, 4) : 0;
  const above = s.steps - midpoint;
  const out: string[] = [];
  for (let i = below; i >= 1; i -= 1) out.push(String(50 - 10 * i));
  out.push("50");
  for (let i = 1; i <= above; i += 1) out.push(String(50 + 10 * i));
  return out;
}

function ownSlugs(section: Record<string, unknown> | undefined, kind: PresetKind): string[] {
  const list = slugs(section?.[OWN_LISTS[kind].list]);
  if (kind === "spacing") list.push(...spacingScaleSlugs(section?.spacingScale));
  return list;
}

function readLayer(settings: Record<string, unknown> | undefined, kind: PresetKind): { own: string[] | null; defaultsFlag: boolean | null } {
  const section = settings?.[OWN_LISTS[kind].section] as Record<string, unknown> | undefined;
  const flag = DEFAULT_FLAGS[kind];
  const flagValue = flag ? (settings?.[flag.section] as Record<string, unknown> | undefined)?.[flag.flag] : undefined;
  const hasOwn = section !== undefined && (section[OWN_LISTS[kind].list] !== undefined || (kind === "spacing" && section.spacingScale !== undefined));
  return { own: hasOwn ? ownSlugs(section, kind) : null, defaultsFlag: typeof flagValue === "boolean" ? flagValue : null };
}

function rootTable(settings: Record<string, unknown> | undefined): Record<PresetKind, Set<string>> {
  const table = {} as Record<PresetKind, Set<string>>;
  for (const kind of Object.keys(OWN_LISTS) as PresetKind[]) {
    const layer = readLayer(settings, kind);
    const set = new Set<string>();
    if (layer.defaultsFlag !== false) for (const slug of CORE_PRESETS[kind]) set.add(slug);
    for (const slug of layer.own ?? []) set.add(slug);
    table[kind] = set;
  }
  return table;
}

function blockTables(settings: Record<string, unknown> | undefined): Map<string, Partial<Record<PresetKind, Set<string>>>> {
  const out = new Map<string, Partial<Record<PresetKind, Set<string>>>>();
  const blocks = settings?.blocks as Record<string, Record<string, unknown>> | undefined;
  for (const [blockName, blockSettings] of Object.entries(blocks ?? {})) {
    const own: Partial<Record<PresetKind, Set<string>>> = {};
    for (const kind of Object.keys(OWN_LISTS) as PresetKind[]) {
      const layer = readLayer(blockSettings, kind);
      if (layer.own !== null) own[kind] = new Set(layer.own);
    }
    out.set(blockName, own);
  }
  return out;
}

/** Every slug the theme defines at the root (plus WordPress's defaults unless turned off), and each block's own extras. */
export function presetTable(settings: Record<string, unknown> | undefined): PresetTable {
  return { root: rootTable(settings), blocks: blockTables(settings) };
}

/**
 * The slugs a style variation can reference, following `WP_Theme_JSON::merge`:
 * a list the variation sets replaces the theme's list of that kind outright
 * (a variation palette of one color leaves one color), a list it does not set
 * stays the theme's, and a defaults flag the variation sets wins.
 */
export function variationPresetTable(themeSettings: Record<string, unknown> | undefined, variationSettings: Record<string, unknown> | undefined): PresetTable {
  const root = {} as Record<PresetKind, Set<string>>;
  for (const kind of Object.keys(OWN_LISTS) as PresetKind[]) {
    const theme = readLayer(themeSettings, kind);
    const variation = readLayer(variationSettings, kind);
    const defaultsOff = (variation.defaultsFlag ?? theme.defaultsFlag) === false;
    const own = variation.own ?? theme.own ?? [];
    const set = new Set<string>();
    if (!defaultsOff) for (const slug of CORE_PRESETS[kind]) set.add(slug);
    for (const slug of own) set.add(slug);
    root[kind] = set;
  }
  const blocks = blockTables(themeSettings);
  for (const [blockName, own] of blockTables(variationSettings)) blocks.set(blockName, { ...(blocks.get(blockName) ?? {}), ...own });
  return { root, blocks };
}

function available(table: PresetTable, kind: PresetKind, blockName: string | undefined): Set<string> {
  const extra = blockName === undefined ? undefined : table.blocks.get(blockName)?.[kind];
  if (!extra || extra.size === 0) return table.root[kind];
  return new Set([...table.root[kind], ...extra]);
}

/** Block attributes whose value is a preset slug, by the kind they name. */
const SLUG_ATTRIBUTES: Record<string, PresetKind> = {
  backgroundColor: "color",
  textColor: "color",
  borderColor: "color",
  overlayColor: "color",
  iconColor: "color",
  iconBackgroundColor: "color",
  overlayBackgroundColor: "color",
  overlayTextColor: "color",
  gradient: "gradient",
  fontSize: "font-size",
  fontFamily: "font-family",
};

const PRESET_REFERENCE = /var:preset\|([a-z-]+)\|([^|)\s"']+)/g;

function unknownPreset(kind: PresetKind, slug: string, known: Set<string>, where: string, loc: SourceLocation | undefined): Diagnostic {
  const candidate = nearest(slug, known);
  const diagnostic: Diagnostic = { code: "unknown_preset", severity: "error", message: `${where} names the ${kind} preset "${slug}", which the theme does not define${CORE_PRESETS[kind].length > 0 ? " and WordPress does not provide" : ""}.`, hint: candidate ? `Did you mean "${candidate}"?` : `Add it to settings in theme.config.ts.` };
  if (loc) diagnostic.loc = loc;
  return diagnostic;
}

/**
 * Check every preset reference in a `styles` tree (`var:preset|color|primary`).
 * `path` is a JSON pointer prefix for messages. Under `styles.blocks.<name>`
 * the block's own presets count too, as they do in WordPress's generated CSS.
 */
export function checkStylePresets(value: unknown, table: PresetTable, path: string, loc: SourceLocation | undefined, into: Diagnostic[], blockName?: string): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(PRESET_REFERENCE)) {
      const kind = match[1] as PresetKind;
      const slug = match[2]!;
      if (!(kind in table.root)) continue;
      const known = available(table, kind, blockName);
      if (!known.has(slug)) into.push(unknownPreset(kind, slug, known, path, loc));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => checkStylePresets(entry, table, `${path}/${index}`, loc, into, blockName));
    return;
  }
  if (typeof value === "object" && value !== null) {
    const atBlocks = /(^|\/)blocks$/.test(path);
    for (const [key, entry] of Object.entries(value)) {
      checkStylePresets(entry, table, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, loc, into, atBlocks ? key : blockName);
    }
  }
}

/** Check the preset-slug attributes and `var:preset` style values of every block in a tree. */
export function checkBlockPresets(nodes: readonly ContentNode[], table: PresetTable, into: Diagnostic[]): void {
  for (const node of nodes) {
    if (node.kind === "block") {
      checkBlock(node, table, into);
      checkBlockPresets(node.inner, table, into);
    } else if (node.kind === "element") checkBlockPresets(node.children, table, into);
  }
}

function checkBlock(node: BlockNode, table: PresetTable, into: Diagnostic[]): void {
  for (const [name, kind] of Object.entries(SLUG_ATTRIBUTES)) {
    const value = node.attrs[name];
    const known = available(table, kind, node.blockName);
    if (typeof value === "string" && value !== "" && !known.has(value)) into.push(unknownPreset(kind, value, known, `${node.blockName}.${name}`, node.loc));
  }
  if (node.attrs.style !== undefined) checkStylePresets(node.attrs.style, table, `${node.blockName}.style`, node.loc, into, node.blockName);
}
