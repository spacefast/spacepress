// A documentation site that mounts @spacepress/docs, the way examples/todo mounts @spacepress/todo:
//   sp/schema.ts                 the docs collection, synced from content/docs/**/*.md
//   sp/components/docs.tsx       the package's Markdown components, made blocks
//   sp/app/layout.tsx            the header (search, GitHub, theme), the page, the footer
//   sp/app/docs/[...path]/page   the sidebar, the doc, page actions, pager and table of contents
//   content/docs/                the pages; components/ shows every component
import { defineConfig } from "spacepress";

export default defineConfig({ name: "docs-site", seed: true });
