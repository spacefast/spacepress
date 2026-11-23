---
uid: zr_d0b2392cf818d42828f0
title: Core Framework
description: Data modeling, queries, access rules, hooks, actions, jobs, routes, and TSX rendering.
order: 2
status: published
publishedAt: 2026-11-21T09:03:00.000Z
---
Learn the core primitives that SpacePress compiles from TypeScript into native PHP and SQL:

- **[Schema & Storage](/docs/core/schema-and-storage)** — `collection()`, `table()`, `global()`, `userProjection()`, `taxonomy()`, `wp.posts`, fields, and automatic SQL migrations.
- **[Queries & Access Control](/docs/core/queries-and-access)** — `spacepress:db` vs trusted `db`, relational filters, role ladder, row-level filters, and field masks.
- **[Actions, Jobs & HTTP Routes](/docs/core/actions-jobs-routes)** — server RPC, Action Scheduler queues, lifecycle hooks, `route.ts`, webhooks, and private file buckets.
- **[Pages, Layouts & Islands](/docs/core/pages-and-islands)** — file-based TSX rendering, forms, `"use client"` Interactivity API components, and static export.
