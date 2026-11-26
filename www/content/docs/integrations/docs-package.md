---
uid: zr_6b4be474d059a9533797
title: Documentation Sites with @spacepress/docs
description: "Build a docs site from Markdown files: the docs collection, Markdown components, the three-column layout, search, and theme tokens."
order: 5
status: published
publishedAt: 2026-11-26T18:00:00.000Z
---
`@spacepress/docs` turns a folder of Markdown files into a documentation site. The files sync into a hierarchical WordPress collection, so editors can also change pages in wp-admin. The package renders them with a sidebar, breadcrumbs, a table of contents, search, page actions, a light and dark theme, and Markdown components such as callouts, cards, steps, tabs and file trees. This site uses it.

Pages work without JavaScript. Two islands add to them: `DocsSearch` (the search dialog) and `DocsEnhancements` (copy buttons on code, **Copy page**, heading anchors, the table of contents following the reader, tab strips and the theme switch).

## What the package exports

| Import | What it gives you |
|---|---|
| `@spacepress/docs/schema` | `createDocsCollection({ label?, url?, sync? })`: a hierarchical collection with `title`, `slug`, `content` and `description`, synced from `content/docs/**/*.md` by default. Anyone can read it; editors write it. |
| `@spacepress/docs/blocks` | The Markdown components, plus the `blocks` list that makes them usable as tags. |
| `@spacepress/docs/docs.css` | The theme. Every color, radius and font is a `--sd-*` CSS variable on `:root`, for light and dark. |
| `@spacepress/docs` | The page parts: `DocsShell`, `DocPage`, `Sidebar`, `Breadcrumbs`, `TableOfContents`, `PageActions`, `Pager`; the islands `DocsSearch`, `DocsEnhancements` and `ThemeToggle`; `themeScript`; `searchEntries(tree)`; `hasIcon(name)`. |

## Set up a docs site

<Steps>
<Step title="Install the package">
```sh
npm install @spacepress/docs
```

To use the package from a local SpacePress checkout instead, depend on `"file:<path>/packages/docs"` and add `install-links=true` to the project's `.npmrc`, as `examples/docs-site` does. npm then copies the package into `node_modules` instead of linking it.
</Step>

<Step title="Add the docs collection">
```ts title="sp/schema.ts"
import { createDocsCollection } from "@spacepress/docs/schema";

export const docs = createDocsCollection({ url: "/docs/:path", sync: "content/docs/**/*.md" });
```

A file's name is its slug, its folder is its parent, and a folder's `index.md` is the page the folder stands for. `content/docs/guides/writing.md` is served at `/docs/guides/writing`.
</Step>

<Step title="Make the components blocks">
```tsx title="sp/components/docs.tsx"
import "@spacepress/docs/docs.css";
export * from "@spacepress/docs/blocks";
```

Re-exporting the package's `blocks` list from a file in `sp/components/` lets Markdown pages write each component as a tag. The stylesheet links on every route, because a block can appear on any page.
</Step>

<Step title="Wrap the site in DocsShell">
```tsx title="sp/app/layout.tsx"
import { docs } from "spacepress/server/db";
import type { LayoutProps } from "spacepress/app";
import { nav } from "spacepress/content";
import { DocsShell, searchEntries } from "@spacepress/docs";

export const template = "blank";

export const metadata = {
  title: { default: "Acme Docs", template: "%s · Acme Docs" },
  scripts: ["/theme.js"],
};

export default async function Root({ children }: LayoutProps) {
  return (
    <DocsShell title="Acme Docs" github="acme/docs" search={searchEntries(await nav(docs))}>
      {children}
    </DocsShell>
  );
}
```

`DocsShell` draws the header (brand, top `links`, search, GitHub link, theme switch) and the footer. Without `search`, the header has no search.
</Step>

<Step title="Render each page with DocPage">
```tsx title="sp/app/docs/[...path]/page.tsx"
import { docs } from "spacepress/server/db";
import type { PageProps } from "./$types";
import { headings, nav, pager } from "spacepress/content";
import { DocPage } from "@spacepress/docs";

export const metadata = ({ item }: PageProps) => ({
  title: item.title,
  description: item.description ?? undefined,
});

export default async function Doc({ item, params }: PageProps) {
  const { prev, next } = await pager(docs, item);
  const path = params.path.join("/");
  return (
    <DocPage
      item={{ title: item.title, description: item.description, content: item.content, updatedAt: item.updatedAt }}
      tree={await nav(docs, item)}
      prev={prev}
      next={next}
      headings={headings(item)}
      markdown={`/docs/${path}.md`}
      site={{ title: "Acme Docs", github: "acme/docs", editPath: "main/content/docs" }}
      source={`${path}.md`}
    />
  );
}
```

`source` is the page's Markdown file below `site.editPath`. With both set, the page actions include **Edit on GitHub**. For a section index, pass its path with `index.md`, such as `guides/index.md`.
</Step>

<Step title="Write and sync">
Add `content/docs/introduction.md` with `title`, `description` and `order` in its front matter, then run `spacepress dev` and `spacepress sync`. See [Two-Way Markdown & Git Sync](/docs/integrations/markdown-sync).
</Step>
</Steps>

<Tip title="Apply the saved theme before the first paint">
`themeScript` is a one-line script that reads the reader's saved theme. Save it as a file in `public/` (for example `public/theme.js`) and list it in the layout's `metadata.scripts`, as above, so the page never flashes the wrong theme.
</Tip>

## Markdown components

A component is a tag on lines of its own. What sits between its tags is Markdown, so a callout can hold lists, code and links. Props take text (`title="…"`), numbers (`cols={3}`) and booleans (`defaultOpen`).

| Component | Use it for |
|---|---|
| `Callout` (`type`: note, tip, warning, danger or check; `title`; `icon`), and the shorthands `Note`, `Tip`, `Warning`, `Danger` | An aside the reader should notice. |
| `CardGroup` (`cols`) with `Card` (`title`, `icon`, `href`, `cta`, `horizontal`) | Link grids on section pages. |
| `Columns` and `Column` | Content side by side. |
| `Steps` with `Step` (`title`) | A numbered procedure. |
| `Tabs` (`param`) with `Tab` (`title`) | Alternatives such as package managers or platforms. With `param="os"` the chosen tab is kept in the address (`?os=Linux`). |
| `Accordion` with `AccordionItem` (`title`, `description`, `icon`, `defaultOpen`), `Expandable` | Content the reader opens on demand. |
| `FileTree` with `Folder` (`name`, `defaultOpen`) and `File` (`name`, `highlight`) | A project layout. |
| `Field` (`name`, `type`, `required`, `defaultValue`) | One documented prop or option. |
| `Badge` (`variant`), `Kbd`, `Tooltip`, `Panel`, `Frame`, `Tile`, `Icon`, `YouTube` | Smaller pieces. |

```md
<Callout type="warning" title="Back up first">
`spacepress migrate` applies every pending migration.
</Callout>

<CardGroup cols={2}>
<Card title="Schema" icon="database" href="/docs/core/schema-and-storage">
Collections, tables and fields.
</Card>

<Card title="Pages" icon="layout-grid" href="/docs/core/pages-and-islands">
TSX routes and islands.
</Card>
</CardGroup>
```

Code fences take a title, marked lines and a tab group. Fences in a row that share a `group` render as tabs with no script:

```sh title="npm" group="install"
npm install @spacepress/docs
```

```sh title="pnpm" group="install"
pnpm add @spacepress/docs
```

Icons are a bundled subset of 100 [Lucide](https://lucide.dev) icons drawn as CSS masks, so they take the text color. `hasIcon(name)` tells you whether a name is in the set. `examples/docs-site/content/docs/components.md` shows every component.

## Search and page actions

`searchEntries(tree)` lists every page of the `nav(docs)` tree with its top-level section. Pass a map from page address to description as the second argument to show a line under each result. Search runs in the browser over that list.

The **Copy page** button copies the page's Markdown, read from the `markdown` address you pass to `DocPage`. Its menu opens the Markdown, asks ChatGPT or Claude about the page, lists `site.resources`, and links to the file on GitHub. Set `site.url` to your public origin so the chat links carry absolute addresses.

## Theme

Override tokens after the package's stylesheet:

```css title="sp/app/site.css"
:root {
  --sd-accent: #7c3aed;
  --sd-radius: 14px;
  --sd-font: "Inter", system-ui, sans-serif;
}
```

Dark mode sets its own values under `:root[data-theme="dark"]` and the dark color scheme. If you change colors, override those too.

## Packages as building blocks

`@spacepress/docs` is an ordinary npm package that a SpacePress app compiles from source. An installed package can ship a schema factory, server components, `"use client"` islands and stylesheets (see [Components from npm packages](/docs/core/pages-and-islands#components-from-npm-packages)). Two packages in the repository follow this pattern:

<CardGroup cols={2}>
<Card title="@spacepress/docs" icon="book-open" href="https://github.com/spacefast/spacepress/tree/main/examples/docs-site">
`examples/docs-site`: a complete docs site, with a page that shows every component.
</Card>

<Card title="@spacepress/todo" icon="list-checks" href="https://github.com/spacefast/spacepress/tree/main/examples/todo">
`examples/todo`: a task and Kanban app built from `createTasksCollection()`, `createTodoBuckets()` and `createTodoSettings()`.
</Card>
</CardGroup>

A package exports factories such as `createDocsCollection()` rather than finished kinds, so the app chooses the export name, URL and sync folder. The kinds belong to the app: its migrations, access rules and generated client include them like any other kind.
