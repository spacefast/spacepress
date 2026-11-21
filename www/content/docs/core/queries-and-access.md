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

## Declarative access rules

The role ladder is ordered: `guest < subscriber < author < editor < admin`. Naming a role admits that role and every higher role.

- Shorthands: `"anyone"`, `"authenticated"`, `"self"`, role name, or boolean.
- Functions: `(ctx) => boolean | AccessFilter` — returning a filter restricts `read`, `update`, and `delete` queries to matching rows (non-matching rows return `404`).
- Field masks: `.access({ read, create, update })` on any column strips or refuses unauthorized fields across REST, pages, and client queries.
