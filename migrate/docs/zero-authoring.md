# Zero authoring constructs in TypedPress

| 0.8 | Now |
|---|---|
| `table({...})` inside `capsule({ schema })` | `export const x = table({...})` |
| `string()`, `number()`, `boolean()` | `text()`, `number()`, `boolean()` |
| `id("tasks")` | `ref(tasks)` |
| `userId()` and owner filters | the implicit `author` and `access: "author"` |
| `.optional()`, `.default()` | unchanged |
| `.index("by_x", [...])` | inferred, or `.index([...])` |
| `query` / `mutation` | `action`, or direct `x.list` / `x.create` under access rules |
| `endpoint({ method, path })` | `app/**/route.ts` |
| `ctx.db.x.withIndex(...).collect()` | `x.list({ where })` |
| `ctx.auth.requireIdentity()` | `access: "subscriber"`, or a guest-enabled rule, plus `ctx.user` |
| `auth.onGuestUpgrade` | not needed: the upgrade keeps the user id |
| `ctx.invalidate(...)` | automatic (change notices) |
