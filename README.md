# Zero

**Zero is a TypeScript framework for building backends, fast.**

You write one `zero.config.ts`. `zero build` turns it into
database migrations, REST endpoints, user authentication, a dashboard and a
fully typed client library. Zero is frontend agnostic: the client is plain `fetch`, so it
works with Next.js, Astro, TanStack Start, or anything else that can call
`fetch`.

Zero is built on top of WordPress and runs alongside a traditional WordPress
setup. It needs WordPress 7.1+, PHP 8.2+ and a small set of plugins that
`zero build` pins for you. Zero apps can be deployed to
[Spacefast](https://spacefast.com) natively.

It's a new, experimental way of building backends for content and personal
software. The API will move. Read [Status](#status) before you build on it.

## One file in

```ts
// zero.config.ts
import {
  collection, table, text, richText, slug, integer, timestamp, media,
  defineRelations, defineConfig, action, db, HttpError,
} from "zero";

export const authors = collection({
  name: text().notNull().max(80),
  avatar: media({ accept: "image" }),
}, { title: "name" });

export const posts = collection({
  title: text().notNull().max(120),
  slug: slug({ source: "title" }),
  body: richText(),
  authorId: integer().references(() => authors.id, { onDelete: "set null" }),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
}, {
  content: "body",
  access: { read: "anyone", create: "author", update: "author", delete: "editor" },
});

export const collections = { authors, posts };
export const stock = table({
  postId: integer().references(() => posts.id),
  quantity: integer().notNull().default(0),
});
export const tables = { stock };

export const relations = defineRelations({ ...collections, ...tables }, (r) => ({
  posts: { author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }) },
  authors: { posts: r.many.posts() },
  stock: { post: r.one.posts({ from: r.stock.postId, to: r.posts.id }) },
}));

export default defineConfig({
  name: "journal",
  collections, tables,
  relations,
  hooks: {
    posts: {
      beforeCreate(data) {
        data.title = data.title.trim();
        if (data.title === "") throw new HttpError(422, "invalid_input", "A post needs a title");
      },
    },
  },
  actions: {
    publishedCount: action({
      input: {},
      access: "anyone",
      async handler() {
        const rows = await db.query.posts.findMany({ where: { status: "published" }, columns: { id: true } });
        return { count: rows.length };
      },
    }),
  },
});
```

## Everything out

```sh
$ zero build
built 2 collections, 0 globals, 1 hooks, 1 actions -> .zero/wp-content in 6s
```

| You get | Where |
|---|---|
| MySQL migrations, diffed against the last build | `zero/migrations/0001_init.sql` |
| A typed client: `zero.posts.list({ with: { author: true } })` and friends | `zero/client/` |
| Editor types, so `db` in your hooks knows your schema | `zero.gen.ts` |
| REST endpoints for every collection, global and action, with relations loaded through `with` | `/wp-json/zero/v1/...` |
| Sign-in, sessions, roles, guests, passkeys and MFA | the `zero-identity` plugin |
| A dashboard: WordPress admin, with a post type and a field group generated for each collection that has an editor | Posts and Authors menus in `wp-admin` |
| Three WordPress plugins plus the pinned platform plugins, as folders and ZIPs | `.zero/wp-content/plugins/` |

Hooks and actions are compiled, not interpreted. Your `beforeCreate` becomes
plain PHP:

```php
function posts__beforeCreate(\Zero\JsObject $data)
{
    $__t1 = $data;
    $__t2 = 'title';
    \Zero\Js::set($__t1, $__t2, \Zero\Js::trim(\Zero\Js::prop($data, 'title')));
    if (\Zero\Js::strictEq(\Zero\Js::prop($data, 'title'), '')) {
        throw new \Zero\HttpError((int) 422, 'invalid_input', 'A post needs a title');
    }
}
```

Rust runs at build time only. At runtime it's PHP, with no JS engine and no
Composer.

## Quick start

There's no binary release or npm package yet. Build the compiler from source
with Rust 1.96 (the checkout pins it). Booting the throwaway WordPress needs
Docker with Compose, plus `bash` 4+, `python3`, `curl`, `sha256sum` and a PHP
8.2 CLI on the host. Then this builds the pantry example and boots it with every
plugin activated:

```sh
git clone https://github.com/spacefast/zero && cd zero
cargo build --release
./target/release/zero dev examples/pantry         # http://127.0.0.1:8787, admin / zero-test-admin
```

It prints one JSON line with an application password for each test user.
Writes need one of those; reads of public collections don't:

```sh
export AUTH="admin:<the admin appPassword from that line>"
BASE=http://127.0.0.1:8787/wp-json/zero/v1

curl -u "$AUTH" -X POST $BASE/locations -d '{"name":"Fridge","kind":"fridge"}'
curl -u "$AUTH" -X POST $BASE/items -d '{"name":" Eggs ","quantity":1,"locationId":1}'
curl $BASE/shopping_list                          # the afterCreate hook added Eggs
curl -u "$AUTH" -X POST $BASE/actions/consume -d '{"itemId":1}'
./target/release/zero doctor examples/pantry --site http://127.0.0.1:8787
```

`zero check` compiles without writing anything; `zero build` writes the
plugins to `.zero/wp-content/` without booting anything. Commit
`zero/migrations/`, `zero/client/`, `zero.gen.ts` and
`zero/wp-plugins.lock.json`; `.zero/` is build output. Stop the site with the
`harness.sh down` command that `zero dev` prints.

## Use it from a frontend

The generated client is dependency-free, erasable TypeScript over `fetch`.
Copy `zero/client/` into any frontend, or import it by path. To try it against
the `journal` config from the top of this page: stop the pantry site, save the
config as `journal/zero.config.ts`, then

```sh
./target/release/zero dev journal                 # builds journal/zero/client/, boots WordPress on :8787
```

Node 22.18+ runs this as-is from the `journal` directory, with the admin
application password from the receipt:

```ts
import { createClient } from "./zero/client/index.ts";

const zero = createClient({
  url: "http://127.0.0.1:8787/wp-json/zero/v1",
  headers: { Authorization: "Basic " + btoa("admin:<application password>") },
});

const author = await zero.authors.create({ name: "Alice" });
const post = await zero.posts.create({ title: "  Hello, Zero  ", authorId: author.id });
console.log(post.slug, post.status);                       // hello-zero published
const posts = await zero.posts.list({ with: { author: true }, orderBy: { updatedAt: "desc" } });
console.log(posts[0]?.author?.name);                       // Alice
console.log(await zero.actions.publishedCount({}));        // { count: 1 }
```

Every argument and result is typed from your schema: `with` keys, filters,
`orderBy`, action inputs and outputs. The post is a real WordPress post, so it
is also in `wp-admin` under Posts. Browser apps sign members in with
`zero.auth.signIn()`, which goes through the zero-identity screens given a
`clientId` and `redirectUri`; see the client's generated README for sessions,
guests and server-to-server auth.

## Requirements

| | Minimum |
|---|---|
| To build | Rust 1.96 (today; see [Status](#status)) |
| To run | WordPress 7.1, PHP 8.2 with `mbstring`, `gd`, `fileinfo`, `openssl` and `sodium`, and MySQL 8.0, MariaDB 10.11 or SQLite through the [SQLite Database Integration](https://wordpress.org/plugins/sqlite-database-integration/) plugin 3.1.2 |
| Required plugins | Secure Custom Fields 6.9.7, Action Scheduler 4.2.0, MCP Adapter 0.7.1, and Polylang 3.9 only when the app uses `locales` |

`zero build` downloads the required plugins at their pinned versions,
verifies their checksums, and ships them next to yours. The runtime refuses to
boot on a site that misses any of them and names each one;
`zero doctor <project> --site <url>` prints the same table from your terminal.

## What's in the box

- **Collections, relations, globals**, Drizzle-style, with Drizzle 1.0's
  relational `findMany`/`findFirst` filters in hooks and actions.
- **Hooks and actions** written in a checked subset of TypeScript and compiled
  to PHP. Anything outside the subset fails the build at `file:line:col` with a
  fix.
- **Access rules** per collection, per action and per field, as roles or
  functions; a collection's read, update and delete rules can return a filter
  instead of a boolean. `showIf` drives conditional fields in the editor.
- **Authentication** through `zero-identity`: sign-in, sessions, roles, guests
  who keep their rows when they sign up, passkeys and MFA. Members are
  WordPress users.
- **Jobs, webhooks and an outbox**: enqueue from a hook, run after the request
  commits through Action Scheduler, retry with backoff.
- **WordPress Abilities and MCP**: your collections' reads and writes, actions
  and globals are registered as Abilities and exposed on a named MCP server,
  so agents can use them. Jobs join with `agents: true`; `agents: false` opts
  anything out; uploads stay out.
- **Media**: named image sizes, focal-point crops, and private file buckets with
  signed, PHP-streamed downloads.
- **Markdown sync**: `zero sync` keeps `content/posts/*.md` and your records in
  step, with a three-way merge and conflict files.
- **Localization** with Polylang: one row per locale, shared fields kept equal,
  a generated `wpml-config.xml`.
- **Migrations in**: `zero migrate config` imports EmDash, Payload or Sanity
  schemas, and `zero migrate site` moves a site built with the
  [original Zero](docs/migrating-from-zero.md).

## Alongside WordPress

A Zero build is three Zero plugins, plus the pinned platform plugins they
depend on:

| Plugin | What it is |
|---|---|
| `zero-runtime` | the shared PHP runtime, versioned with the compiler |
| `zero-identity` | accounts, passkeys, MFA and an OpenID Connect issuer |
| `zero-app-<name>` | your app: schema, compiled hooks and actions, MySQL migrations |

Each `collection(fields, options?)` is a custom post type (`zero_<name>`) with a
Secure Custom Fields group, so your content shows up in WordPress admin with
revisions, and in the block editor when the collection has a `content` field,
next to whatever the site already does.
Use `table(fields, options?)` for app data in its own SQL table. Both kinds
support references and one/many relations to either kind, with typed client
queries and target access rules. The registry key supplies the name once:
`shoppingList` stays `zero.shoppingList` in the client and stores in
`wp_zero_shopping_list`. `userProjection()` in `users` projects existing
WordPress users for auth; it creates no second user table. Core `/wp/v2` routes and
admin screens for Zero's post types follow Zero's access rules. Need other
plugins at exact versions? [Declare them in the config](docs/wp-plugins.md)
and the build pins and ships them too.

## Deploy

Zero apps can be deployed to [Spacefast](https://spacefast.com) natively.

Anywhere else: the build is `.zero/wp-content/plugins/*.zip`, which you upload
or copy like any plugin, and `.zero/wp-content/zero-manifest.json` records the
versions and the activation order. Jobs run through Action Scheduler, so make
sure WP-Cron or a real cron reaches the site.

## Examples

| Example | Shows |
|---|---|
| [`examples/pantry`](examples/pantry) | plain tables, hooks, actions, relations and a background job; the quick start |
| [`examples/blog`](examples/blog) | the CMS tour: field access, sync, members and sign-in, image sizes and private files, jobs and webhooks, translations, with a browser page |
| [`examples/site`](examples/site) | the publication that the system suite drives end to end |
| [`examples/wp-plugins`](examples/wp-plugins) | pinning extra WordPress plugins from the config |

[`docs/examples.md`](docs/examples.md) walks through each one and how to run it.

## Docs

- [`docs/config-api.md`](docs/config-api.md): the `zero.config.ts` API, the enforced subset and the known gaps
- [`docs/examples.md`](docs/examples.md): the examples, how to run each, and the suites that prove them
- [`docs/wp-plugins.md`](docs/wp-plugins.md): declaring and pinning WordPress plugins
- [`docs/identity-api.md`](docs/identity-api.md) and [`docs/identity-security.md`](docs/identity-security.md): the `zero-identity` plugin
- [`docs/config-migration.md`](docs/config-migration.md): importing EmDash, Payload and Sanity schemas
- [`docs/migrating-from-zero.md`](docs/migrating-from-zero.md): moving a site from the original Zero
- [`docs/runtime-contract.md`](docs/runtime-contract.md): the seam between compiler output and the PHP runtime
- [`CONTRIBUTING.md`](CONTRIBUTING.md): how the compiler works, the test suites, the layout

## Status

Zero is new and experimental. The examples build and run end to end on
WordPress, and CI proves it on every change, but the config API, the wire
format and the plugin layout will change before a first release. There are no
binary releases yet; you build the compiler from source.

In progress: Zero Admin, an optional admin plugin for Zero apps. Its source is
in the repo under `runtime/admin/`, and `defineConfig({ admin: true })` ships
it as a fourth plugin; its screens are still being completed.

What's next, none of it shipped:

- A website with an interactive config builder that loads your config into
  WordPress Playground, and one-click publish to Spacefast.
- Zero Blocks: an optional add-on for authoring Gutenberg content and full
  block themes in TSX.

## License

Zero is licensed by component, and [`LICENSE`](LICENSE) maps every path.
Everything that runs inside WordPress is GPL-2.0-or-later: the PHP runtime,
the `zero-identity` and `zero-admin` plugins and the plugins `zero build`
emits. Everything else is MIT: the Rust compiler, the TypeScript client, the
`"zero"` types, the examples, the docs and the tests. Bundled third-party
code keeps its own license; see the `THIRD-PARTY-LICENSES.txt` files under
`runtime/`.
