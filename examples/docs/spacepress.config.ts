// A documentation site on SpacePress: the content features in one app.
// - sp/app/page.tsx and sp/app/about/page.md: a code page and a Markdown page (a real
//   WordPress Page the file starts and the site owns);
// - sp/schema.ts: the docs as a hierarchical kind synced from content/docs/**/*.md;
// - sp/app/docs/[...path]/page.tsx: one page renders every doc, with "spacepress/server/content"'s
//   navigation, previous and next, and table of contents;
// - sp/components/Callout.tsx: components a Markdown file uses as blocks;
// - code fences with titles, marked lines and tab groups, highlighted with no script;
// - `output: "static"`: `spacepress export` writes the whole site as files that need no WordPress.
import { defineConfig } from "spacepress";

export default defineConfig({ name: "docs", output: "static" });
