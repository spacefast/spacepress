/**
 * `@spacefast/zero-blocks/theme`: what a theme's `theme.config.ts`,
 * templates, parts, patterns and style variations import.
 */
export {
  defineTheme, defineTemplate, definePart, definePattern, defineStyleVariation, preset,
  type Theme, type ThemeConfig, type ThemeHeader, type ThemeSettings, type ThemeStyles, type ThemeTokens,
  type TemplateMeta, type PartMeta, type PatternMeta, type StyleVariation,
  type CustomTemplateDeclaration, type TemplatePartDeclaration,
} from "./define.ts";
export type { ThemeJson } from "./theme-json.generated.d.ts";
export * from "./components.ts";
export { Block, Fragment, blockComponent } from "../index.ts";
