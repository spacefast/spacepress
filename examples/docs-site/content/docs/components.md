---
uid: zr_e7c9b1f92da9d31bed59
title: Components
description: "Every component a page can write as a tag, with what it renders."
order: 3
status: published
publishedAt: 2026-11-26T17:23:51.000Z
---
A component is a tag on lines of its own. What sits between its tags is Markdown, so a callout can hold lists, code and links. Props take text (`title="…"`), numbers (`cols={3}`) and booleans (`defaultOpen`).

## Callouts

<Callout type="note" title="Note">
For background the reader can skip.
</Callout>

<Callout type="tip" title="Tip">
A shortcut or a better way.
</Callout>

<Callout type="warning" title="Warning">
Something that can go wrong.
</Callout>

<Callout type="danger" title="Danger">
Something that loses data.
</Callout>

<Callout type="check">
A result to expect. `Note`, `Tip`, `Warning` and `Danger` are shorter names for the same thing.
</Callout>

```md
<Callout type="tip" title="Tip">
A shortcut or a better way.
</Callout>
```

## Cards

<CardGroup cols={3}>
<Card title="Fast" icon="zap">
Pages are PHP; no client framework.
</Card>

<Card title="Typed" icon="shield-check">
The compiler checks every prop.
</Card>

<Card title="Linked" icon="link" href="/docs/quickstart" cta="Start">
A card with `href` links.
</Card>
</CardGroup>

`Card` takes `title`, `href`, `icon`, `cta` and `horizontal`. `CardGroup` and `Columns` take `cols`.

## Steps

<Steps>
<Step title="Write">
Add a Markdown file.
</Step>

<Step title="Sync">
Run `spacepress sync`.
</Step>

<Step title="Read">
Open the page.
</Step>
</Steps>

## Tabs

<Tabs param="os">
<Tab title="macOS">
Install with Homebrew.
</Tab>

<Tab title="Linux">
Install with your package manager.
</Tab>

<Tab title="Windows">
Install with winget.
</Tab>
</Tabs>

With `param="os"` the choice is kept in the address (`?os=Linux`), so a link opens on the same tab. Without JavaScript every tab shows, one after another.

## Code groups

Fences that share a `group` become tabs with no script at all.

```sh title="npm" group="install"
npm install @spacepress/docs
```

```sh title="pnpm" group="install"
pnpm add @spacepress/docs
```

## Accordion

<Accordion>
<AccordionItem title="Does it need Node in production?" icon="server">
No. The site runs as PHP on WordPress.
</AccordionItem>

<AccordionItem title="Can editors change pages?" defaultOpen>
Yes, in wp-admin. `spacepress sync` brings their changes back to the files.
</AccordionItem>
</Accordion>

<Expandable title="Show the props">
`AccordionItem` takes `title`, `description`, `icon` and `defaultOpen`. `Expandable` takes `title` and `defaultOpen`.
</Expandable>

## Badges

<Badge>
Stable
</Badge>

<Badge variant="accent">
New
</Badge>

<Badge variant="success">
Passing
</Badge>

<Badge variant="warning">
Beta
</Badge>

<Badge variant="danger">
Deprecated
</Badge>

## File tree

<FileTree>
<Folder name="sp">
<File name="schema.ts" />

<Folder name="app">
<File name="layout.tsx" />

<File name="page.tsx" highlight />
</Folder>
</Folder>

<File name="spacepress.config.ts" />
</FileTree>

## Fields

<Field name="title" type="string" required>
The page title, from front matter.
</Field>

<Field name="order" type="number" defaultValue="0">
Where the page sits among its siblings.
</Field>

## Panel and frame

<Panel title="Good to know">
A panel sets content apart without the weight of a callout.
</Panel>

<Frame caption="A framed visual">
![The SpacePress mark](https://spacepress.dev/favicon.svg)
</Frame>

## Tooltip and keys

<Tooltip tip="Hover or focus shows this." headline="Tooltip">
Hover this phrase
</Tooltip>

<Kbd>
⌘K
</Kbd>

`Kbd` marks a key. A component is a block, so it sits on its own lines; inline text keeps using backticks.

## Icons

<Icon name="rocket" size={20} />

<Icon name="database" size={20} />

<Icon name="globe" size={20} />

The package bundles 100 [Lucide](https://lucide.dev) icons. `Card`, `Callout` and `AccordionItem` take an `icon` name too.

## Video

<YouTube id="aqz-KE-bpKQ" title="Big Buck Bunny" />
