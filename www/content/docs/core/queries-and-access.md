---
uid: zr_863af58e96e756fc5907
title: Queries & Access Control
description: Visitor-scoped typedpress:db queries, trusted db queries, filtering operators, and declarative access rules.
order: 2
status: published
publishedAt: 2026-11-21T09:05:00.000Z
---
## Visitor-scoped vs trusted database APIs

Import named kinds from `"typedpress:db"` for visitor-scoped operations that automatically enforce access rules, draft visibility, and field masks:

```ts
import { posts } from "typedpress:db";

const published = await posts.list({
  where: { tags: { has: "release" } },
  orderBy: { publishedAt: "desc" },
  with: { cover: true },
  limit: 20,
});

// Explicit system escalation when needed:
const all = await posts.system.list({ limit: 100 });
```

Inside hooks, jobs, and trusted server actions, you can also use the Drizzle-inspired `db` API from `"typedpress"`:

```ts
import { db } from "typedpress";

const row = await db.query.posts.findFirst({ where: { slug: "hello" } });
const [created] = await db.insert(tasks).values({ title: "Ship v1" }).returning();
```

## Search

`list({ search })` and `count({ search })` on a kind, `?search=` on its API and core list routes, `GET /search` and core's `/wp/v2/search` match words at the start of a word in the kind's searchable fields. Results keep the list's own order.

By default the searchable fields are the title, the content and every `text()` or `richText()` field. Mark fields with `.searchable()` to choose them yourself. Once any field of a kind is marked, only the title, the content and the marked fields are searched. `.searchable(false)` removes a field, including the title or content:

```ts
import { collection, email, richText, text } from "typedpress";

export const recipes = collection({
  title: text(),
  method: richText().searchable(),
  chef: email().searchable(),
  // Not searched: other fields are marked, and this one isn't.
  supplierCode: text().optional(),
  // Never searched, whatever else is marked.
  internalName: text().optional().searchable(false),
}, { url: "/recipes/:slug" });
```

`.searchable()` takes `text()`, `richText()`, `email()`, `url()` and `slug()` fields of a collection or table. It isn't valid on `select()`, numbers or other kinds, nor inside a group, repeater or blocks field, a global or a taxonomy.

Access still applies to every search. A reader matches only the rows their read rule returns and only the fields they may read. A word found only in a field hidden from the reader never matches. When a build changes a kind's searchable fields, a queued job rebuilds that kind's index.

## Declarative access rules

The role ladder is ordered: `guest < subscriber < author < editor < admin`. Naming a role admits that role and every higher role.

- Shorthands: `"anyone"`, `"authenticated"`, `"self"`, role name, or boolean.
- Functions: `(ctx) => boolean | AccessFilter` (sync or `async`) — returning a filter restricts `read`, `update`, and `delete` queries to matching rows (non-matching rows return `404`). Collection, table, global, action, route, and file-bucket access functions may run read-only trusted queries (`db.query.<kind>`, `db.globals.<name>.get`, `<kind>.system` reads) to check memberships or grants; writes, viewer-scoped kind reads, `fetch`, mail, jobs, and field-access queries are refused. Results for rules evaluated without `data` are memoized per request and invalidated on any database write or rollback.
- Field masks: `.access({ read, create, update })` on any column strips or refuses unauthorized fields across REST, pages, and client queries.
