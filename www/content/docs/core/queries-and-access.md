---
uid: zr_863af58e96e756fc5907
title: Queries & Access Control
description: Visitor-scoped spacepress/server/db queries, trusted db queries, filtering operators, and declarative access rules.
order: 2
status: published
publishedAt: 2026-11-21T09:05:00.000Z
---
## Visitor-scoped vs trusted database APIs

Import named kinds from `"spacepress/server/db"` for visitor-scoped operations that automatically enforce access rules, draft visibility, and field masks:

```ts
import { posts } from "spacepress/server/db";

const published = await posts.list({
  where: { tags: { has: "release" } },
  orderBy: { publishedAt: "desc" },
  with: { cover: true },
  limit: 20,
});

// Explicit system escalation when needed:
const all = await posts.system.list({ limit: 100 });
```

Inside hooks, jobs, queries and mutations, the Drizzle-style `db` API from `"spacepress/server"` reads and writes without the visitor's access rules:

```ts
import { db } from "spacepress/server";

const row = await db.query.posts.findFirst({ where: { slug: "hello" } });
const [created] = await db.insert(tasks).values({ title: "Ship v1" }).returning();
```

## Search

`list({ search })` and `count({ search })` on a kind, `?search=` on its API and core list routes, `GET /search` and core's `/wp/v2/search` match words at the start of a word in the kind's searchable fields. Results keep the list's own order.

By default the searchable fields are the title, the content and every `text()` or `richText()` field. Mark fields with `.searchable()` to choose them yourself. Once any field of a kind is marked, only the title, the content and the marked fields are searched. `.searchable(false)` removes a field, including the title or content:

```ts
import { collection, email, richText, text } from "spacepress";

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

A kind's `access` takes `read`, `create`, `update`, `delete`, `restore` and `purge` rules. Each rule is one of:

- **A shorthand:** `"anyone"`, `"authenticated"`, `"self"`, `"system"`, a role name, or a boolean.
- **A function** `(ctx) => boolean | AccessFilter`, sync or `async`. Returning a filter limits `read`, `update` and `delete` to the matching rows; other rows answer `404`.

### Queries inside access rules

Access functions on collections, tables, globals, queries, mutations, routes and file buckets may run read-only trusted queries: `db.query.<kind>.findFirst` / `findMany`, `db.globals.<name>.get()`, and reads through `<kind>.system`. Use them to check memberships or grants:

```ts
import { integer, ref, select, table, text } from "spacepress";
import { db } from "spacepress/server";

export const projects = table({ name: text() }, {
  access: { read: "authenticated", create: "editor", update: "editor", delete: "editor" },
});

export const members = table({
  userId: integer(),
  project: ref(projects).onDelete("cascade"),
  role: select(["viewer", "editor"]),
}, { access: { read: "admin", create: "admin", update: "admin", delete: "admin" } });

export const tasks = table({
  title: text(),
  project: ref(projects).onDelete("cascade"),
}, {
  access: {
    async read({ user }) {
      if (!user) return false;
      const rows = await db.query.members.findMany({ where: { userId: user.id } });
      return { project: { in: rows.map((row) => row.project) } };
    },
    create: "authenticated",
    update: "editor",
    delete: "editor",
  },
});
```

- A rule's result is kept for the rest of the request when the rule ran without row `data`. Any database write or rollback in the request clears the kept results.
- Writes, visitor-scoped kind reads (`tasks.list()`), `fetch`, mail, jobs, `once`, connectors, Abilities and WordPress functions are refused in access rules.
- Field rules (`.access()` on a column) stay synchronous and can't query, so they never run one query per row.

### Field masks

`.access({ read, create, update })` on a column strips the field from answers, or refuses writes to it, for callers the rule doesn't admit. It applies on REST, pages, Abilities and client queries alike.
