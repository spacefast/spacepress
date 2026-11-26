# `@spacepress/docs`

A documentation site for a [SpacePress](https://spacepress.dev) app. The docs are Markdown files in a hierarchical WordPress collection. The package renders them with a three-column layout, search, page actions, a light and dark theme, and Markdown components such as callouts, cards, steps, tabs and file trees.

Pages work without JavaScript. Two islands add to them: `DocsSearch` (the search dialog) and `DocsEnhancements` (code copy buttons, "Copy page", heading anchors, the table of contents following the reader, tab strips and the theme switch).

## What it provides

| Export | What it is |
| --- | --- |
| `@spacepress/docs/schema` | `createDocsCollection({ label?, url?, sync? })`: a hierarchical collection synced from `content/docs/**/*.md`. A file's name is its slug, its folder its parent, and a folder's `index.md` the page the folder stands for. |
| `@spacepress/docs/blocks` | The Markdown components: `Callout` (`Note`, `Tip`, `Warning`, `Danger`), `Card`, `CardGroup`, `Columns`, `Column`, `Steps`, `Step`, `Tabs`, `Tab`, `Accordion`, `AccordionItem`, `Expandable`, `Badge`, `Panel`, `Frame`, `Tile`, `Tooltip`, `Kbd`, `YouTube`, `FileTree`, `Folder`, `File`, `Field`, `Icon`. |
| `@spacepress/docs/docs.css` | The theme. Every color, radius and font is a `--sd-*` token on `:root`, for light and dark. |
| `@spacepress/docs` | The page parts: `DocsShell` (header, search, GitHub link, theme switch, footer), `DocPage` (sidebar, breadcrumbs, article, page actions, pager, table of contents), `Sidebar`, `Breadcrumbs`, `TableOfContents`, `PageActions`, `Pager`; the islands `DocsSearch` and `DocsEnhancements`; and `searchEntries(tree)`, which turns a docs tree into search entries. |

Icons are a bundled Lucide subset drawn as CSS masks, so they take the text color and need no script. `hasIcon(name)` says whether a name is in the set.

## Usage

```ts
// sp/schema.ts
import { createDocsCollection } from "@spacepress/docs/schema";

export const docs = createDocsCollection({ url: "/docs/:path", sync: "content/docs/**/*.md" });
```

```tsx
// sp/components/docs.tsx: the components become blocks Markdown pages can use as tags
import "@spacepress/docs/docs.css";
export * from "@spacepress/docs/blocks";
```

```tsx
// sp/app/layout.tsx
import { docs } from "spacepress:db";
import type { LayoutProps } from "spacepress/app";
import { nav } from "spacepress/content";
import { DocsShell, searchEntries } from "@spacepress/docs";

export const metadata = { title: { default: "Acme Docs", template: "%s · Acme Docs" }, scripts: ["/theme.js"] };

export default async function Root({ children }: LayoutProps) {
  return (
    <DocsShell title="Acme Docs" github="acme/docs" search={searchEntries(await nav(docs))}>
      {children}
    </DocsShell>
  );
}
```

```tsx
// sp/app/docs/[...path]/page.tsx
import { docs } from "spacepress:db";
import type { PageProps } from "spacepress/app";
import { headings, nav, pager } from "spacepress/content";
import { DocPage } from "@spacepress/docs";

export default async function Doc({ item, params }: PageProps<"docs/[...path]">) {
  const { prev, next } = await pager(docs, item);
  const path = params.path.join("/");
  return (
    <DocPage
      item={item}
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

So the remembered theme applies before the page paints, serve `themeScript` as a file in `public/` and list it in the layout's `metadata.scripts`, as above.

To change the look, override tokens after the import:

```css
:root { --sd-accent: #7c3aed; --sd-font: "Inter", system-ui, sans-serif; }
```

See [`examples/docs-site`](../../examples/docs-site) for a complete site, including a page that shows every component.

## Tests

```sh
npm test --prefix packages/docs
```
