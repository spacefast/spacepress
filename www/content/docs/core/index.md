---
uid: zr_d0b2392cf818d42828f0
title: Core Framework
description: Data modeling, queries, access rules, server functions, jobs, routes, and TSX rendering.
order: 2
status: published
publishedAt: 2026-11-21T09:03:00.000Z
---
The primitives SpacePress compiles from TypeScript into PHP and SQL:

<CardGroup cols={2}>
<Card title="Schema & Storage" icon="database" href="/docs/core/schema-and-storage">
`collection()`, `table()`, `global()`, `userProjection()`, `taxonomy()`, `wp.posts`, fields, and migrations.
</Card>

<Card title="Queries & Access Control" icon="shield-check" href="/docs/core/queries-and-access">
Visitor-scoped `spacepress/server/db` and trusted `db`, search, and access rules.
</Card>

<Card title="Queries, Mutations, Jobs & Routes" icon="workflow" href="/docs/core/actions-jobs-routes">
`query()`, `mutation()`, `job()`, hooks, `route.ts`, connectors, and file buckets.
</Card>

<Card title="Pages, Layouts & Islands" icon="layout-grid" href="/docs/core/pages-and-islands">
TSX pages, forms, `"use client"` islands with `useLive` and `useMutation`, and page caching.
</Card>
</CardGroup>
