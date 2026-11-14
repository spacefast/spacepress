// A documentation site on First: the content features in one app.
// - first/app/page.tsx and first/app/about/page.md: a code page and a Markdown page (a real
//   WordPress Page the file starts and the site owns);
// - first/schema.ts: the docs as a hierarchical kind synced from content/docs/**/*.md;
// - first/app/docs/[...path]/page.tsx: one page renders every doc, with "first/content"'s
//   navigation, previous and next, and table of contents;
// - first/components/Callout.tsx: components a Markdown file uses as blocks;
// - code fences with titles, marked lines and tab groups, highlighted with no script;
// - `output: "static"`: `first export` writes the whole site as files that need no WordPress.
import { defineConfig } from "first";

export default defineConfig({ name: "docs", output: "static" });
