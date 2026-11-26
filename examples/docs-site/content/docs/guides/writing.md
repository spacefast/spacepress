---
uid: zr_81341ee9f2e718e98ab3
title: Writing pages
description: "Front matter, headings, code blocks, and how files become the sidebar."
order: 1
status: published
publishedAt: 2026-11-26T17:23:52.000Z
---
## Files and the sidebar

A file's name is its address and its folder is its parent: `content/docs/guides/writing.md` is `/docs/guides/writing`. A folder's `index.md` is the page the folder stands for. Siblings sort by `order`, then by title.

## Front matter

```yaml
---
title: Writing pages
description: The line under the title, in search results and link previews.
order: 1
---
```

## Headings

`##` and `###` headings fill the table of contents on the right. Each gets an anchor link when you hover it.

### A third-level heading

It shows indented in the table of contents.

## Code

Fences take a title and marked lines:

```ts title="sp/schema.ts" {3}
import { createDocsCollection } from "@spacepress/docs/schema";

export const docs = createDocsCollection();
```

Every block gets a copy button.

## Links and images

Link to another page by its address: [Configuration](/docs/guides/configuration). Images go in `sp/public/` or the media library.
