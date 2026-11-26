---
uid: zr_54d327ab551c32be24fd
title: Introduction
description: "A documentation site that is a SpacePress app, written in Markdown and served by WordPress."
order: 1
status: published
publishedAt: 2026-11-26T17:23:51.000Z
---
<Badge variant="accent">
SpacePress
</Badge>

This site is a SpacePress app built on [`@spacepress/docs`](https://github.com/spacefast/spacepress/tree/main/packages/docs). Each page is a Markdown file under `content/docs/`. `spacepress sync` keeps the WordPress records equal to the files, so editors can also change pages in wp-admin.

<CardGroup cols={2}>
<Card title="Quickstart" href="/docs/quickstart" icon="rocket">
Add the package to an app and publish your first page.
</Card>

<Card title="Components" href="/docs/components" icon="blocks">
Callouts, cards, steps, tabs, accordions, file trees and more.
</Card>

<Card title="Writing pages" href="/docs/guides/writing" icon="pencil">
Front matter, headings, code blocks and links.
</Card>

<Card title="Configuration" href="/docs/guides/configuration" icon="settings">
The header, search, theme tokens and page actions.
</Card>
</CardGroup>

## What you get

| Feature                     | How it works                                                                                                |
|-----------------------------|-------------------------------------------------------------------------------------------------------------|
| Sidebar, breadcrumbs, pager | `nav()` and `pager()` from `spacepress/content`, read as the visitor                                        |
| Table of contents           | The page's `##` and `###` headings, highlighted while you scroll                                            |
| Search                      | ⌘K or `/` opens a dialog over every page; it needs no hosted index                                        |
| Light and dark              | Follows the system until the reader picks one                                                               |
| AI-ready                    | Every page has a Markdown twin, `/llms.txt` lists them, and the page menu opens a page in ChatGPT or Claude |
| No build step               | Pages render as PHP on WordPress, or export to static files                                                 |

## How it is built

The app has five files of its own. Everything else comes from the package.

<FileTree>
<Folder name="sp">
<File name="schema.ts" />

<Folder name="components">
<File name="docs.tsx" />
</Folder>

<Folder name="app">
<File name="layout.tsx" />

<File name="page.tsx" />

<Folder name="docs/[...path]">
<File name="page.tsx" highlight />
</Folder>
</Folder>
</Folder>

<Folder name="content/docs">
<File name="introduction.md" />
</Folder>

<File name="spacepress.config.ts" />
</FileTree>
