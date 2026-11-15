# Imports under the typedpress name

Date: 2026-11-15. Status: proposed. Spec: [rendering.md](../spec/rendering.md) §4.1,
[WordPress from TypeScript](2026-11-07-wordpress-from-typescript.md).

An app imports from eight places today, named three different ways:

| Today | What it is | Where it runs |
|---|---|---|
| `"first"` | Config DSL (`collection`, `text`, `defineConfig`, `action`, `job`) and runtime APIs (`db`, `jobs`, `mail`, `env`, `once`, `files`, `HttpError`) | Compiled to PHP |
| `"first/app"` | Page helpers: `notFound`, `redirect`, `Link`, `Html`, `Live`, `PageProps` | Compiled to PHP |
| `"first/content"` | `nav`, `pager`, `headings`, `apiReference` | Compiled to PHP |
| `"first/client"` | `"use client"` hooks: `useState`, `useEffect`, `useLive` | Compiled to an Interactivity API store; no JavaScript behind it |
| `"first:db"` | The app's kinds by name | Compiled to PHP |
| `"php/wordpress"` | `abilities`, hook `Handler` types, 17 core functions | Compiled to PHP |
| `./first/_generated/client/index.ts`, `react.ts` | Typed `fetch` client, copied into every app | Browser, Node, Bun, Deno |
| `@first/client` | The same client as a WordPress script module ID | Browser |

Apps reach the types through tsconfig `paths` entries pointing into
`node_modules/@spacefast/first-cli/types/`.

## The rule

The path says where the code runs.

- **`typedpress`**: describing the app. Config DSL and types, safe to import
  anywhere (a frontend can import a row type).
- **`typedpress/server/*`**: code that only exists on the server. Each subpath
  is a real `exports` entry with `.d.ts` types and a `browser` condition that
  throws `typedpress/server/<name> runs only on the server`, the same trick as
  Next.js's `server-only` package. A browser bundle that pulls one in fails at
  build time, and the name says why before anyone runs it.
- **`@typedpress/client*`**: real JavaScript for the browser and other runtimes.
  It is a separate package because `typedpress` carries the compiler binary,
  and a Next.js or Astro frontend should not download a Rust binary to get a
  `fetch` client.

Because each module is a real subpath of an installed package, TypeScript
resolves it with no tsconfig `paths` and no ambient declarations.

## Layout

| New | Replaces | Holds |
|---|---|---|
| `typedpress` | the DSL half of `"first"` | `defineConfig`, `collection`, `table`, fields, `action`, `job`, `defineRelations`, types |
| `typedpress/server` | the runtime half of `"first"` | `db`, `jobs`, `mail`, `env`, `once`, `files`, `HttpError` |
| `typedpress/server/db` | `"first:db"` | The app's kinds by name |
| `typedpress/server/app` | `"first/app"` | Page and layout helpers (pages are server components) |
| `typedpress/server/content` | `"first/content"` | Navigation and API reference |
| `typedpress/server/wp` | `"php/wordpress"` | WordPress core under WordPress's names: `abilities`, hook types, core functions, `WP_Post`/`WP_User`/`WP_Query` |
| `typedpress/server/wp/<plugin-slug>` | `"php/<plugin-slug>"` (planned) | A pinned plugin's functions (`typedpress/server/wp/woocommerce`) |
| `typedpress/server/php` | `"php"` (planned) | Allowlisted PHP built-in functions under their php.net names |
| `typedpress/server/utils` | (new) | Hand-written PHP helpers: Bun-style utilities and WordPress aliases |
| `@typedpress/client` | `first/_generated/client/index.ts`, script module `@first/client` | `createClient`, `watch`, `Query`, the error class |
| `@typedpress/client/react` | `first/_generated/client/react.ts` and `"first/client"` | React hooks: `useQuery`, `useMutation`, `useLive`, `sharedState`, `useMount`, `useEvent` |

`node:crypto` stays: it is npm compatibility, not our API.

Tooling packages: `typedpress` (binary and types; replaces
`@spacefast/first-cli`), `@typedpress/bin-<target>`, `create-typedpress`,
`@typedpress/astro`, `@typedpress/blocks`.

### `typedpress/server/php`

PHP's own global functions under their PHP names (`str_contains`,
`array_is_list`, `mb_strwidth`, `hrtime`, `number_format`), so php.net is the
documentation. Types come from the PHP stubs at the PHP floor (8.2), through
the same generator and pin file as the WordPress catalog. A function is
admitted under the rules the WordPress module already uses: no by-reference
parameters, no output, no hidden global state. Each call compiles to a direct
PHP call.

### `typedpress/server/wp`

WordPress under WordPress's names (`get_option`, `esc_html`,
`wp_insert_post`), as `php/wordpress` does now: same allowlist, same
`WP_Error` → `HttpError` rule, same capability records. Only the path changes.

### `typedpress/server/utils`

camelCase helpers an app reaches for in most handlers, each one a
hand-written static method in the runtime so it costs one PHP call.

**Bun-style utilities.**

| Export | Bun counterpart | PHP |
|---|---|---|
| `escapeHTML(s)` | `Bun.escapeHTML` | `htmlspecialchars(ENT_QUOTES \| ENT_SUBSTITUTE)` |
| `password.hash(p)`, `password.verify(p, h)` | `Bun.password` | `password_hash(PASSWORD_ARGON2ID)` with a bcrypt fallback, `password_verify` |
| `hash(data, algo?)` | `Bun.hash` | `hash('xxh3')` default |
| `deepEquals(a, b)` | `Bun.deepEquals` | Hand-written over the runtime's JS values |
| `randomUUIDv7()` | `Bun.randomUUIDv7` | `random_bytes` + millisecond clock |
| `semver.satisfies`, `semver.order` | `Bun.semver` | Hand-written; `version_compare` is not semver |
| `stringWidth(s)` | `Bun.stringWidth` | `mb_strwidth` |
| `nanoseconds()` | `Bun.nanoseconds` | `hrtime(true)` |
| `gzip`, `gunzip` | `Bun.gzipSync` | `gzencode`, `gzdecode` |
| `glob.match(pattern, path)` | `Bun.Glob#match` | `fnmatch` with `FNM_PATHNAME` |
| `inspect(v)` | `Bun.inspect` | Hand-written, for logs |

**WordPress aliases**, readable names for what apps already use:

| Export | WordPress |
|---|---|
| `slugify(s)` | `sanitize_title` |
| `stripTags(s)` | `wp_strip_all_tags` |
| `sanitizeHTML(s)` | `wp_kses_post` |
| `autop(s)` | `wpautop` |
| `trimWords(s, n)` | `wp_trim_words` |
| `timeAgo(date)` | `human_time_diff` |
| `formatBytes(n)` | `size_format` |
| `isEmail(s)` | `is_email` |
| `nonce.create(action)`, `nonce.verify(n, action)` | `wp_create_nonce`, `wp_verify_nonce` |
| `cache.remember(key, ttlSeconds, fn)` | `wp_cache_get`/`wp_cache_set`, transient when no persistent object cache |

An alias exists only when the camelCase name says more than the WordPress
name or saves a common two-call pattern. Everything else stays in
`typedpress/server/wp` under its own name.

## Client components import React

Today `"first/client"` is types only: a `"use client"` component cannot run
anywhere except through the compiler. Instead, a client component imports
`useState`, `useEffect` and `useRef` from `"react"`, and the
typedpress-specific hooks from `@typedpress/client/react`:

```tsx
"use client";
import { useState } from "react";
import { useLive } from "@typedpress/client/react";
```

- **In a test, Storybook or another React app** the file is a plain React
  component: `@typedpress/client/react` has real implementations (`useLive`
  is `useQuery` over the typed client, `sharedState` is a
  `useSyncExternalStore` store, `useMount` and `useEvent` are effects).
- **In `typedpress build`** the compiler recognises the same imports and
  lowers the supported subset to the Interactivity API, as it does now, with
  no React shipped to the page.
- **Outside the subset** (React context, portals, `forwardRef`, Radix, so
  most shadcn components) the build refuses today, as `rendering.md` §4.1
  says. Running those needs a real React or Preact island on the page, which
  `rendering.md` ruled out ("no React or Preact bundle of our own"). That is a
  separate decision, and the import layout here doesn't block it.

## How the generated client reaches the runtime

Other tools split a generated client in one of three ways (checked against
each project's docs and source on 2026-11-15):

| Pattern | Who | Trade-off |
|---|---|---|
| Runtime package, app passes a type parameter: `createClient<Database>()` | Supabase, openapi-fetch, tRPC, Hono | Types only, no generated JS. Only works when the runtime needs no app data |
| Runtime package, generated file augments a registry interface in it | Payload (`GeneratedTypes`), TanStack Router, Sanity | One global app per project. Sanity left `declare module "@sanity/client"` for `declare global` in v6.13 because a second copy of the package under pnpm silently dropped the types |
| Generated code in the source tree imports the runtime package | Prisma 7 (`prisma-client`, `output` required), Convex (`_generated/api.js` over `convex/server`), Gel | Generated file holds the app's types and data; runtime ships as a package |

Prisma's old layout, which generated into `node_modules/.prisma/client`,
broke under pnpm and in monorepos, and Prisma 7 deprecates it. Generated
files belong in the project.

Our client needs app data at runtime, not just types: the `SCHEMA`
descriptor holds each collection's path and relations (for `watch`), and
the bucket, action and global names the client builds methods from. So a
type parameter alone is not enough, and we take the third pattern, as
Convex does:

```ts
// typedpress/_generated/client.ts (generated: types and SCHEMA, no client code)
import { bind } from "@typedpress/client";
import type { App } from "./client-types.ts";
import { SCHEMA } from "./client-schema.ts";
export const createClient = bind<App>(SCHEMA);
export type * from "./client-types.ts";
```

```ts
// app or frontend code
import { createClient } from "./typedpress/_generated/client.ts";
const tp = createClient();
```

- No module augmentation, so two apps in one frontend each get their own
  typed client, and a duplicate package copy can't drop the types.
- A client fix ships as a release of `@typedpress/client`. The generated
  file changes only when the schema does.
- A frontend in another repository installs `@typedpress/client` and gets
  the generated file from `/__typedpress/client.d.ts` and `client.js` (today
  `/__first/…`), which the runtime already serves.

## Order of work

1. Restructure the modules under the current name: split `"first"` into DSL
   and `first/server`, move `first:db`, `first/app`, `first/content` and
   `php/wordpress` under `first/server/`, publish the client runtime as a
   package, switch client components to `"react"` imports.
2. Add `server/php` and `server/utils`.
3. Last, rename First to typedpress everywhere (binary, packages,
   `typedpress.config.ts`, the `typedpress/` folder, PHP namespaces, table and
   option prefixes, REST namespaces, headers, diagnostics) with a codemod in
   the style of `scripts/rename-to-first.mjs`.

No First app runs in production (#243), so none of this keeps aliases. Stored
bundles captured earlier read their old specifiers through
`Fs::module_alias`, which already maps `"zero"` to the current name.

Counted on `origin/main` at b55dd58d with
`git grep -hoE "from ['\"]<spec>['\"]"` over examples, docs, docs-site,
packages, types, skills, tests, src and runtime: `"first"` 741, `"first/app"`
82, `"first:db"` 47, `"php/wordpress"` 45, `"first/content"` 20,
`"first/client"` 17.
