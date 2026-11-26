---
uid: zr_f98ff51dc5635649d3aa
title: Quickstart
description: Add @spacepress/docs to a SpacePress app and publish a page.
order: 2
status: published
publishedAt: 2026-11-26T17:23:51.000Z
---
<Steps>
<Step title="Install the package">
<Tabs param="pm">
<Tab title="npm">
```sh
npm install @spacepress/docs
```
</Tab>

<Tab title="pnpm">
```sh
pnpm add @spacepress/docs
```
</Tab>

<Tab title="bun">
```sh
bun add @spacepress/docs
```
</Tab>
</Tabs>
</Step>

<Step title="Add the docs collection">
```ts title="sp/schema.ts"
import { createDocsCollection } from "@spacepress/docs/schema";

export const docs = createDocsCollection();
```
</Step>

<Step title="Make the components blocks">
```tsx title="sp/components/docs.tsx"
import "@spacepress/docs/docs.css";
export * from "@spacepress/docs/blocks";
```
</Step>

<Step title="Render the pages">
```tsx title="sp/app/docs/[...path]/page.tsx"
import { docs } from "spacepress/server/db";
import type { PageProps } from "spacepress/app";
import { headings, nav, pager } from "spacepress/content";
import { DocPage } from "@spacepress/docs";

export default async function Doc({ item, params }: PageProps<"docs/[...path]">) {
  const tree = await nav(docs, item);
  const { prev, next } = await pager(docs, item);
  const path = params.path.join("/");
  return (
    <DocPage
      item={{ title: item.title, description: item.description, content: item.content, updatedAt: item.updatedAt }}
      tree={tree}
      prev={prev}
      next={next}
      headings={headings(item)}
      markdown={`/docs/${path}.md`}
      site={{ title: "My docs" }}
    />
  );
}
```
</Step>

<Step title="Write and sync">
Add `content/docs/introduction.md`, then run `spacepress dev` and `spacepress sync`.
</Step>
</Steps>

<Callout type="tip" title="Wrap the site">
`DocsShell` in the root layout adds the header with search, the GitHub link and the theme switch. See [Configuration](/docs/guides/configuration).
</Callout>
