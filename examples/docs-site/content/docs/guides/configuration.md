---
uid: zr_32c5adb4337311317fe0
title: Configuration
description: "The header, search, theme tokens, and page actions."
order: 2
status: published
publishedAt: 2026-11-26T17:23:51.000Z
---
## The header

`DocsShell` draws the header and footer. It takes the site's `title`, a one-letter `mark`, top `links`, a `github` repository and the `search` entries.

```tsx title="sp/app/layout.tsx"
import { docs } from "spacepress:db";
import type { LayoutProps } from "spacepress/app";
import { nav } from "spacepress/content";
import { DocsShell, searchEntries } from "@spacepress/docs";

export const template = "blank";

export default async function Root({ children }: LayoutProps) {
  return (
    <DocsShell title="Acme Docs" github="acme/docs" search={searchEntries(await nav(docs))}>
      {children}
    </DocsShell>
  );
}
```

## Theme

Every color, radius and font is a CSS variable. Override them after the package's stylesheet:

```css title="sp/app/site.css"
:root {
  --sd-accent: #7c3aed;
  --sd-radius: 14px;
  --sd-font: "Inter", system-ui, sans-serif;
}
```

<Callout type="note">
Dark mode sets its own values under `:root[data-theme="dark"]` and the dark color scheme. Override those too if you change colors.
</Callout>

To apply a reader's saved theme before the first paint, serve `themeScript` as a file in `sp/public/` and list it in the layout's `metadata.scripts`.

## Page actions

The button beside each title copies the page as Markdown. Its menu opens the Markdown twin, asks ChatGPT or Claude about the page, and links to the file on GitHub when `site.github` and `site.editPath` are set.

## Search

`searchEntries(tree)` lists every page with its section. Pass a map from page address to description as the second argument to show a line under each result.
