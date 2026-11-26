// @spacepress/docs: a documentation site for a SpacePress app.
//
//   ./schema   createDocsCollection(): the docs as a hierarchical collection synced from Markdown
//   ./blocks   the Markdown components (Callout, Card, Steps, Tabs, ...), re-exported as blocks
//   ./docs.css the theme: light and dark, tokens an app overrides on :root
//   .          the page parts (DocPage, Sidebar, TableOfContents, PageActions, Pager), the
//              islands (DocsSearch, DocsEnhancements, ThemeToggle) and the search helper
export * from "./schema";
export * from "./blocks";
export { Breadcrumbs, DocPage, type DocItem, type DocsSite, PageActions, Pager, Sidebar, TableOfContents, trail } from "./ui/layout";
export { DocsSearch } from "./ui/Search";
export { DocsEnhancements } from "./ui/Enhance";
export { ThemeToggle, themeScript } from "./ui/theme";
export { DocsShell, type HeaderLink } from "./ui/shell";
export { hasIcon } from "./ui/Icon";
export { searchEntries, type SearchEntry } from "./entries";
