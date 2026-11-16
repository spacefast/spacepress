// A documentation site on TypedPress: the content features in one app.
// - tp/app/page.tsx and tp/app/about/page.md: a code page and a Markdown page (a real
//   WordPress Page the file starts and the site owns);
// - tp/schema.ts: the docs as a hierarchical kind synced from content/docs/**/*.md;
// - tp/app/docs/[...path]/page.tsx: one page renders every doc, with "typedpress/content"'s
//   navigation, previous and next, and table of contents;
// - tp/components/Callout.tsx: components a Markdown file uses as blocks;
// - code fences with titles, marked lines and tab groups, highlighted with no script;
// - `output: "static"`: `typedpress export` writes the whole site as files that need no WordPress.
import { defineConfig } from "typedpress";

export default defineConfig({ name: "docs", output: "static" });
