---
uid: zr_3cf401278d74432f5345
title: "Introducing SpacePress: TypeScript That Compiles Directly to WordPress"
slug: introducing-spacepress
excerpt: "Write schemas, SQL tables, access rules, server actions, background jobs, and TSX pages in TypeScript — compiled with Rust into native PHP and WordPress plugins with zero Node.js in production."
status: published
publishedAt: 2026-11-21T10:00:00.000Z
---
Today we are introducing **SpacePress** (`spacepress.dev`) — a full-stack TypeScript framework whose Rust and OXC compiler turns your application directly into native PHP, numbered SQL migrations, OpenAPI 3.1, a typed client, and standard WordPress plugins.

## Why compile TypeScript to WordPress?

Teams building content-heavy products, editorial sites, and storefronts face an awkward split: either adopt a modern TypeScript stack and rebuild editorial workflows, media libraries, permissions, comments, and commerce from scratch — or adopt WordPress and give up end-to-end type safety, clean migrations, and modern component authoring.

SpacePress bridges both worlds without running a Node.js server in production:

- **One TypeScript schema, two storage engines:** Use `collection()` for WordPress posts (with Gutenberg, drafts, revisions, staged versions, and comments) right alongside `table()` for relational SQL tables with automatic migrations and compound indexes.
- **Native PHP compilation:** Declarative access rules, field validation, transactional hooks, `action()` RPC endpoints, Action Scheduler `job()` queues, custom `route.ts` handlers, and file-based TSX pages all compile directly to PHP.
- **Progressive interactivity:** Forms bound to server actions work without JavaScript, while `"use client"` components compile to WordPress Interactivity API stores with `useState` and live-updating `useLive()`.
- **Ecosystem included:** Native WooCommerce store & optimistic cart hooks, React Email transactional templates, two-way Markdown & Git sync, modern SpacePress Admin (`/wp-admin/new/`), `@typedpress/blocks` for Gutenberg in TSX, `@typedpress/astro` for external frontends, and a built-in MCP server for AI coding agents.

## Built with SpacePress itself

Everything you are reading on **spacepress.dev** is itself a real SpacePress application:

- This blog post is synced from `www/content/posts/introducing-spacepress.md` via `wp.posts.extend()` and rendered through `tp/app/blog/[slug]/page.tsx` with WordPress's native `<Comments>` component.
- The `/docs` section is synced from `www/content/docs/**/*.md` into a hierarchical `docs` collection rendered with `nav()`, `pager()`, and `headings()`.
- The `/examples` directory lives in a custom SQL `table()` whose GitHub star counts refresh asynchronously on Action Scheduler via the `refreshStars` job.
- Saved links in the `/play` browser playground are stored in the `shares` SQL table via the `share` server action, while the live compiler sandboxes across `/`, `/quick-start`, `/handbook`, and `/play` run our real Rust compiler compiled to WebAssembly (`compiler.wasm`).

## Try it now

Head to the [Quick Start](/quick-start) to launch a local WordPress site in under three minutes, explore the [Interactive Handbook](/handbook) with live compiler sandboxes in every section, or jump straight into the [Playground](/play) right in your browser.
