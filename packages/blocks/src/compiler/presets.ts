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

export type PresetTable = Record<PresetKind, Set<string>>;

function slugs(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => (typeof (entry as { slug?: unknown } | null)?.slug === "string" ? [(entry as { slug: string }).slug] : []));
}

/** Every slug a theme (or a theme plus a variation layered on it) may reference, per kind. */
export function presetTable(...settingsLayers: readonly (Record<string, unknown> | undefined)[]): PresetTable {
  const table = {} as PresetTable;
  for (const kind of Object.keys(OWN_LISTS) as PresetKind[]) {
    const set = new Set<string>();
    const flag = DEFAULT_FLAGS[kind];
    // Defaults stay unless some layer turns them off; the base theme's flag is what WordPress reads first.
    const defaultsOff = flag !== null && settingsLayers.some((layer) => ((layer?.[flag.section] as Record<string, unknown> | undefined)?.[flag.flag]) === false);
    if (!defaultsOff) for (const slug of CORE_PRESETS[kind]) set.add(slug);
    for (const layer of settingsLayers) {
      const section = layer?.[OWN_LISTS[kind].section] as Record<string, unknown> | undefined;
      for (const slug of slugs(section?.[OWN_LISTS[kind].list])) set.add(slug);
      // Per-block presets (`settings.blocks["core/button"].color.palette`) count too.
      const blocks = layer?.blocks as Record<string, Record<string, Record<string, unknown>>> | undefined;
      if (blocks) for (const block of Object.values(blocks)) for (const slug of slugs(block?.[OWN_LISTS[kind].section]?.[OWN_LISTS[kind].list])) set.add(slug);
    }
    table[kind] = set;
  }
  return table;
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

function unknownPreset(kind: PresetKind, slug: string, table: PresetTable, where: string, loc: SourceLocation | undefined): Diagnostic {
  const candidate = nearest(slug, table[kind]);
  const diagnostic: Diagnostic = { code: "unknown_preset", severity: "error", message: `${where} names the ${kind} preset "${slug}", which the theme does not define${CORE_PRESETS[kind].length > 0 ? " and WordPress does not provide" : ""}.`, hint: candidate ? `Did you mean "${candidate}"?` : `Add it to settings in theme.config.ts.` };
  if (loc) diagnostic.loc = loc;
  return diagnostic;
}

/** Check every preset reference in a `styles` tree (`var:preset|color|primary`). `path` is a JSON pointer prefix for messages. */
export function checkStylePresets(value: unknown, table: PresetTable, path: string, loc: SourceLocation | undefined, into: Diagnostic[]): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(PRESET_REFERENCE)) {
      const kind = match[1] as PresetKind;
      const slug = match[2]!;
      if (!(kind in table)) continue;
      if (!table[kind].has(slug)) into.push(unknownPreset(kind, slug, table, path, loc));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => checkStylePresets(entry, table, `${path}/${index}`, loc, into));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) checkStylePresets(entry, table, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, loc, into);
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
    if (typeof value === "string" && value !== "" && !table[kind].has(value)) into.push(unknownPreset(kind, value, table, `${node.blockName}.${name}`, node.loc));
  }
  if (node.attrs.style !== undefined) checkStylePresets(node.attrs.style, table, `${node.blockName}.style`, node.loc, into);
}
