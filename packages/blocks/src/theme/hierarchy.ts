/**
 * WordPress's template hierarchy, as names a block theme's `templates/` folder
 * may use without declaring them. Everything else is a custom template and
 * needs `defineTemplate({ title })`.
 *
 * The lists are WordPress 7.1's: `get_default_block_template_types()` for the
 * fixed slugs, `get_query_template()` callers for the derived forms, and
 * `get_attachment_template()` plus `get_allowed_mime_types()` for the
 * attachment forms (`<type>`, `<subtype>`, `<type>-<subtype>`).
 */

/** `get_default_block_template_types()` on WordPress 7.1, minus the post-format taxonomy entries, which are the taxonomy form below. */
export const DEFAULT_TEMPLATE_TYPES: readonly string[] = [
  "index", "home", "front-page", "singular", "single", "page", "archive", "author", "category", "taxonomy", "date", "tag", "attachment", "search", "privacy-policy", "404",
];

/** The MIME types WordPress serves attachments as (`get_allowed_mime_types()` on 7.1, first halves). */
export const ATTACHMENT_MIME_TYPES: readonly string[] = ["image", "video", "audio", "application", "text"];

/** The second halves of the same list. A bare `<subtype>` template is also a form the hierarchy tries. */
export const ATTACHMENT_MIME_SUBTYPES: readonly string[] = [
  "jpeg", "gif", "png", "bmp", "tiff", "webp", "avif", "x-icon", "heic", "heif", "heic-sequence", "heif-sequence",
  "x-ms-asf", "x-ms-wmv", "x-ms-wmx", "x-ms-wm", "avi", "divx", "x-flv", "quicktime", "mpeg", "mp4", "ogg", "webm", "x-matroska", "3gpp", "3gpp2",
  "plain", "csv", "tab-separated-values", "calendar", "richtext", "css", "vtt", "ttaf+xml",
  "aac", "x-realaudio", "wav", "flac", "midi", "x-ms-wma", "x-ms-wax",
  "rtf", "pdf", "java", "x-tar", "zip", "x-gzip", "rar", "x-7z-compressed", "octet-stream", "msword", "vnd.ms-powerpoint", "vnd.ms-write", "vnd.ms-excel", "vnd.ms-access", "vnd.ms-project",
  "vnd.openxmlformats-officedocument.wordprocessingml.document", "vnd.ms-word.document.macroEnabled.12", "vnd.openxmlformats-officedocument.wordprocessingml.template", "vnd.ms-word.template.macroEnabled.12",
  "vnd.openxmlformats-officedocument.spreadsheetml.sheet", "vnd.ms-excel.sheet.macroEnabled.12", "vnd.ms-excel.sheet.binary.macroEnabled.12", "vnd.openxmlformats-officedocument.spreadsheetml.template", "vnd.ms-excel.template.macroEnabled.12", "vnd.ms-excel.addin.macroEnabled.12",
  "vnd.openxmlformats-officedocument.presentationml.presentation", "vnd.ms-powerpoint.presentation.macroEnabled.12", "vnd.openxmlformats-officedocument.presentationml.slideshow", "vnd.ms-powerpoint.slideshow.macroEnabled.12", "vnd.openxmlformats-officedocument.presentationml.template", "vnd.ms-powerpoint.template.macroEnabled.12", "vnd.ms-powerpoint.addin.macroEnabled.12", "vnd.openxmlformats-officedocument.presentationml.slide", "vnd.ms-powerpoint.slide.macroEnabled.12",
  "onenote", "oxps", "vnd.ms-xpsdocument", "vnd.oasis.opendocument.text", "vnd.oasis.opendocument.presentation", "vnd.oasis.opendocument.spreadsheet", "vnd.oasis.opendocument.graphics", "vnd.oasis.opendocument.chart", "vnd.oasis.opendocument.database", "vnd.oasis.opendocument.formula",
  "wordperfect", "vnd.apple.keynote", "vnd.apple.numbers", "vnd.apple.pages",
];

/** What a slug a block theme's file name can be: WordPress's own template-file rule (lowercase, digits, dashes, dots, underscores). */
export const TEMPLATE_SLUG = /^[a-z0-9][a-z0-9._-]*$/;

export type TemplateKind =
  | { kind: "default"; base: string }
  | { kind: "derived"; base: string; specifier: string }
  | { kind: "attachment"; mime: string }
  | { kind: "custom" };

/** A derived-form prefix (`single-`, `page-`) and whether WordPress resolves a file by it. */
const DERIVED_PREFIXES: readonly string[] = ["single", "page", "archive", "category", "tag", "taxonomy", "author"];

/**
 * How WordPress would resolve `templates/<slug>.html`: a default type, a
 * derived form of one, an attachment MIME form, or none of these (custom,
 * which needs a declaration).
 */
export function classifyTemplate(slug: string): TemplateKind {
  if (DEFAULT_TEMPLATE_TYPES.includes(slug)) return { kind: "default", base: slug };
  if (ATTACHMENT_MIME_TYPES.includes(slug) || ATTACHMENT_MIME_SUBTYPES.includes(slug)) return { kind: "attachment", mime: slug };
  for (const type of ATTACHMENT_MIME_TYPES) {
    if (slug.startsWith(`${type}-`) && ATTACHMENT_MIME_SUBTYPES.includes(slug.slice(type.length + 1))) return { kind: "attachment", mime: `${type}/${slug.slice(type.length + 1)}` };
  }
  for (const base of DERIVED_PREFIXES) {
    if (slug.startsWith(`${base}-`) && slug.length > base.length + 1) return { kind: "derived", base, specifier: slug.slice(base.length + 1) };
  }
  return { kind: "custom" };
}

/** The template-part areas WordPress 7.1 allows (`get_allowed_block_template_part_areas()`); anything else becomes uncategorized with a warning. */
export const TEMPLATE_PART_AREAS = ["uncategorized", "header", "footer", "navigation-overlay"] as const;
export type TemplatePartArea = (typeof TEMPLATE_PART_AREAS)[number];

/** The area a part gets when its file declares none: by name, as WordPress's own themes do. */
export function defaultPartArea(slug: string): TemplatePartArea {
  if (slug === "header" || slug.startsWith("header-")) return "header";
  if (slug === "footer" || slug.startsWith("footer-")) return "footer";
  return "uncategorized";
}

/** The tag WordPress wraps a part in, per area (`get_allowed_block_template_part_areas()[...]['area_tag']`). */
export function partTagName(area: TemplatePartArea): "header" | "footer" | "div" {
  return area === "header" ? "header" : area === "footer" ? "footer" : "div";
}
