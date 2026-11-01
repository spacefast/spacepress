/**
 * The theme author's vocabulary: `defineTheme` for `theme.config.ts`, the
 * `define*` helpers for a file's `meta`, `preset.*` for `var:preset|…`
 * references, and the typed tokens a theme's slugs become.
 *
 * Everything here is data. The compiler (`compiler/theme.ts`) reads these
 * values back from the executed modules; nothing runs on the site.
 */
import type { ThemeJson } from "./theme-json.generated.d.ts";

export type ThemeSettings = NonNullable<ThemeJson["settings"]>;
export type ThemeStyles = NonNullable<ThemeJson["styles"]>;
export type CustomTemplateDeclaration = NonNullable<ThemeJson["customTemplates"]>[number];
export type TemplatePartDeclaration = NonNullable<ThemeJson["templateParts"]>[number];

/** The `style.css` header fields. `name` and `slug` are required; the rest have defaults the README states. */
export interface ThemeHeader {
  /** `Theme Name`. */
  name: string;
  /** The directory name, `Text Domain`, and the prefix of every pattern slug. Lowercase, digits and dashes. */
  slug: string;
  /** `Version`; defaults to `0.1.0`. */
  version?: string | undefined;
  /** `Description`. */
  description?: string | undefined;
  /** `Author`. */
  author?: string | undefined;
  /** `Author URI`. */
  authorUri?: string | undefined;
  /** `Theme URI`. */
  themeUri?: string | undefined;
  /** `License`; defaults to `GPL-2.0-or-later`, what WordPress expects of a theme. */
  license?: string | undefined;
  /** `License URI`. */
  licenseUri?: string | undefined;
  /** `Tags`, written comma-separated. */
  tags?: readonly string[] | undefined;
  /** `Requires at least`; defaults to `7.1`, the floor the pinned block library encodes. */
  requiresWp?: string | undefined;
  /** `Requires PHP`; defaults to `8.2`. */
  requiresPhp?: string | undefined;
  /** `Tested up to`. */
  testedUpTo?: string | undefined;
}

export interface ThemeConfig extends ThemeHeader {
  settings?: ThemeSettings | undefined;
  styles?: ThemeStyles | undefined;
  /** Merged with the entries derived from `templates/`; a declared name must exist as a file. */
  customTemplates?: readonly CustomTemplateDeclaration[] | undefined;
  /** Merged with the entries derived from `parts/`; a declared name must exist as a file. */
  templateParts?: readonly TemplatePartDeclaration[] | undefined;
  /** `theme.json`'s `patterns`: slugs to pull from the wordpress.org Pattern Directory. Passed through untouched. */
  patterns?: readonly string[] | undefined;
  /** Pattern slugs a plugin registers, so `<Pattern slug>` may reference them. A compile-time allow-list; writes nothing. */
  externalPatterns?: readonly string[] | undefined;
}

type PresetSlugs<T> = T extends readonly (infer Item)[] ? (Item extends { slug: infer S } ? (S extends string ? S : never) : never) : never;
type SettingsOf<C> = C extends { settings: infer S } ? S : never;
type Palette<C> = SettingsOf<C> extends { color: { palette: infer P } } ? P : never;
type Gradients<C> = SettingsOf<C> extends { color: { gradients: infer P } } ? P : never;
type Duotone<C> = SettingsOf<C> extends { color: { duotone: infer P } } ? P : never;
type FontSizes<C> = SettingsOf<C> extends { typography: { fontSizes: infer P } } ? P : never;
type FontFamilies<C> = SettingsOf<C> extends { typography: { fontFamilies: infer P } } ? P : never;
type SpacingSizes<C> = SettingsOf<C> extends { spacing: { spacingSizes: infer P } } ? P : never;
type Shadows<C> = SettingsOf<C> extends { shadow: { presets: infer P } } ? P : never;

type TokenMap<S extends string> = { readonly [K in S]: K };

/** The theme's own preset slugs as literal types, so a renamed slug is a type error where it is used. */
export interface ThemeTokens<C> {
  readonly color: TokenMap<PresetSlugs<Palette<C>>>;
  readonly gradient: TokenMap<PresetSlugs<Gradients<C>>>;
  readonly duotone: TokenMap<PresetSlugs<Duotone<C>>>;
  readonly fontSize: TokenMap<PresetSlugs<FontSizes<C>>>;
  readonly fontFamily: TokenMap<PresetSlugs<FontFamilies<C>>>;
  readonly spacing: TokenMap<PresetSlugs<SpacingSizes<C>>>;
  readonly shadow: TokenMap<PresetSlugs<Shadows<C>>>;
}

export interface Theme<C extends ThemeConfig = ThemeConfig> {
  readonly kind: "theme";
  readonly config: C;
  readonly tokens: ThemeTokens<C>;
}

function slugsOf(list: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(list)) return out;
  for (const entry of list) {
    const slug = (entry as { slug?: unknown } | null)?.slug;
    if (typeof slug === "string") out[slug] = slug;
  }
  return out;
}

/**
 * Declare the theme. The `const` type parameter keeps every slug literal, so
 * `theme.tokens.color.primary` is the type `"primary"` and a slug that does
 * not exist is a type error.
 */
export function defineTheme<const C extends ThemeConfig>(config: C): Theme<C> {
  const settings = (config.settings ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const tokens = {
    color: slugsOf(settings.color?.palette),
    gradient: slugsOf(settings.color?.gradients),
    duotone: slugsOf(settings.color?.duotone),
    fontSize: slugsOf(settings.typography?.fontSizes),
    fontFamily: slugsOf(settings.typography?.fontFamilies),
    spacing: slugsOf(settings.spacing?.spacingSizes),
    shadow: slugsOf(settings.shadow?.presets),
  } as unknown as ThemeTokens<C>;
  return { kind: "theme", config, tokens };
}

export function isTheme(value: unknown): value is Theme {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "theme" && typeof (value as { config?: unknown }).config === "object";
}

/** `var:preset|<kind>|<slug>`: the form `theme.json` styles and block attributes use for a preset. */
export const preset = {
  color: (slug: string): string => `var:preset|color|${slug}`,
  gradient: (slug: string): string => `var:preset|gradient|${slug}`,
  fontSize: (slug: string): string => `var:preset|font-size|${slug}`,
  fontFamily: (slug: string): string => `var:preset|font-family|${slug}`,
  spacing: (slug: string): string => `var:preset|spacing|${slug}`,
  shadow: (slug: string): string => `var:preset|shadow|${slug}`,
} as const;

/** A `templates/<name>.tsx` outside WordPress's hierarchy: the entry `theme.json`'s `customTemplates` gets. */
export interface TemplateMeta {
  readonly kind: "template";
  readonly title: string;
  readonly postTypes?: readonly string[] | undefined;
}

export function defineTemplate(meta: { title: string; postTypes?: readonly string[] | undefined }): TemplateMeta {
  return { kind: "template", title: meta.title, postTypes: meta.postTypes };
}

/** A `parts/<name>.tsx`'s entry in `theme.json`'s `templateParts`. */
export interface PartMeta {
  readonly kind: "part";
  readonly title?: string | undefined;
  readonly area?: string | undefined;
}

export function definePart(meta: { title?: string | undefined; area?: string | undefined }): PartMeta {
  return { kind: "part", title: meta.title, area: meta.area };
}

/** A `patterns/<name>.tsx`'s header, in the fields `WP_Theme::get_block_patterns()` reads. */
export interface PatternMeta {
  readonly kind: "pattern";
  readonly title: string;
  /** Defaults to `<theme-slug>/<file-name>`. */
  readonly slug?: string | undefined;
  readonly description?: string | undefined;
  readonly categories?: readonly string[] | undefined;
  readonly keywords?: readonly string[] | undefined;
  readonly blockTypes?: readonly string[] | undefined;
  readonly postTypes?: readonly string[] | undefined;
  readonly templateTypes?: readonly string[] | undefined;
  readonly inserter?: boolean | undefined;
  readonly viewportWidth?: number | undefined;
}

export function definePattern(meta: Omit<PatternMeta, "kind">): PatternMeta {
  return { kind: "pattern", ...meta };
}

/** A `styles/<name>.ts`: a style variation, the same document shape as `theme.json`. */
export interface StyleVariation {
  readonly kind: "style-variation";
  readonly title: string;
  readonly settings?: ThemeSettings | undefined;
  readonly styles?: ThemeStyles | undefined;
}

export function defineStyleVariation(meta: { title: string; settings?: ThemeSettings | undefined; styles?: ThemeStyles | undefined }): StyleVariation {
  return { kind: "style-variation", title: meta.title, settings: meta.settings, styles: meta.styles };
}

export function hasKind<K extends string>(value: unknown, kind: K): value is { kind: K } {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === kind;
}
