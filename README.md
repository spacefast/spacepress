# Zero

**Zero is a TypeScript framework for building backends, fast.**

You write one `zero.config.ts`. `zero build` turns it into database
migrations, REST endpoints, user authentication, a dashboard and a fully typed
client library. Zero is frontend agnostic: the client is plain `fetch`, so it
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
  collection, id, text, richText, slug, integer, timestamp, media,
  defineRelations, defineConfig, action, db, HttpError,
} from "zero";

export const authors = collection("authors", {
  id: id(),
  name: text().notNull().max(80),
  avatar: media({ accept: "image" }),
}, { title: "name" });

export const posts = collection("posts", {
  id: id(),
  title: text().notNull().max(120),
  slug: slug({ source: "title" }),
  body: richText(),
  authorId: integer().references(() => authors.id, { onDelete: "set null" }),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
}, {
  content: "body",
  access: { read: "anyone", create: "author", update: "author", delete: "editor" },
});

export const schema = { authors, posts };

export const relations = defineRelations(schema, (r) => ({
  posts: { author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }) },
  authors: { posts: r.many.posts() },
}));

export default defineConfig({
  name: "journal",
  schema,
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
built 2 collections, 0 globals, 1 hooks, 1 actions for standalone -> .zero/app (new migrations zero/migrations/sqlite/0001_init.sql, zero/migrations/wp/0001_init.sql) in 726ms
```

| You get | Where |
|---|---|
| SQLite and MySQL migrations, diffed against the last build | `zero/migrations/{sqlite,wp}/0001_init.sql` |
| A typed client: `zero.posts.list({ with: { author: true } })` and friends | `zero/client/` |
| Editor types, so `db` in your hooks knows your schema | `zero.gen.ts` |
| REST endpoints for every collection, global and action, with relations loaded through `with` | `/api/...` standalone, `/wp-json/zero/v1/...` on WordPress |
| Sign-in, sessions, roles, guests and MFA | the `zero-identity` plugin on WordPress; passwords and CLI tokens standalone |
| A dashboard: WordPress admin, with a post type and a field group generated for each collection that has an editor | `zero build --target wp` |
| Three WordPress plugins plus the pinned platform plugins, as folders and ZIPs | `.zero/wp-content/plugins/` |

Hooks and actions are compiled, not interpreted. Your `beforeCreate` becomes
plain PHP:

```php
function posts__beforeCreate(array &$data)
{
    $data['title'] = \Zero\Js::trim($data['title']);
    if ($data['title'] === '') {
        throw new \Zero\HttpError((int) 422, 'invalid_input', 'A post needs a title');
    }
}
```

Rust runs at build time only. At runtime it's PHP, with no JS engine and no
Composer.

## Quick start

There's no binary release or npm package yet. Build the compiler from source
with Rust 1.96 (the checkout pins it), then run the pantry example:

```sh
git clone https://github.com/spacefast/zero && cd zero
cargo build --release
./target/release/zero dev examples/pantry      # build, then serve on http://127.0.0.1:8787
```

Writes need a user. In a second terminal:

```sh
./target/release/zero users add me --role editor --dir examples/pantry
./target/release/zero tokens create me --dir examples/pantry   # {"data":{"token":"zt_...","id":1}}
export TOKEN=zt_...

curl -X POST localhost:8787/api/locations -H "Authorization: Bearer $TOKEN" -d '{"name":"Fridge","kind":"fridge"}'
curl -X POST localhost:8787/api/items -H "Authorization: Bearer $TOKEN" -d '{"name":" Eggs ","quantity":1,"locationId":1}'
curl localhost:8787/api/shopping_list            # the afterCreate hook added Eggs
curl -X POST localhost:8787/api/actions/consume -H "Authorization: Bearer $TOKEN" -d '{"itemId":1}'
curl localhost:8787/api/shopping_list            # a moment later, the notifyLowStock job stamped notifiedAt
```

The same project builds for WordPress. Stop the standalone server (Ctrl-C),
then, from a checkout with Docker running, boot a throwaway WordPress with your
plugins activated:

```sh
./target/release/zero build examples/pantry --target wp   # .zero/wp-content/plugins/*.zip
./target/release/zero dev examples/pantry --wp            # http://127.0.0.1:8787, admin / zero-test-admin
./target/release/zero doctor examples/pantry --site http://127.0.0.1:8787
```

`zero check` compiles for both targets and writes nothing. Commit
`zero/migrations/`, `zero/client/`, `zero.gen.ts` and, for WordPress builds,
`zero/wp-plugins.lock.json`; `.zero/` is build output.

## Use it from a frontend

The generated client is dependency-free, erasable TypeScript over `fetch`.
Copy `zero/client/` into any frontend, or import it by path. Node 22.18+ runs
it as-is:

```ts
import { createClient } from "./zero/client/index.ts";

const zero = createClient({ url: "http://127.0.0.1:8787/api", token: "zt_..." });

const author = await zero.authors.create({ name: "Alice" });
const post = await zero.posts.create({ title: "  Hello, Zero  ", authorId: author.id });
console.log(post.slug, post.status);                       // hello-zero published
const posts = await zero.posts.list({ with: { author: true }, orderBy: { updatedAt: "desc" } });
console.log(posts[0]?.author?.name);                       // Alice
console.log(await zero.actions.publishedCount({}));        // { count: 1 }
```

Every argument and result is typed from your schema: `with` keys, filters,
`orderBy`, action inputs and outputs. The client is built for one target:
`zero build --target wp` generates one whose `url` is `/wp-json/zero/v1` and
whose `zero.auth.signIn()` goes through the zero-identity screens, given a
`clientId` and `redirectUri`. See the client's generated README for sessions,
guests and server-to-server auth.

## Requirements

| | Minimum |
|---|---|
| To build | Rust 1.96 (today; see [Status](#status)) |
| WordPress target | WordPress 7.1, PHP 8.2 with `mbstring`, `gd`, `fileinfo`, `openssl` and `sodium`, MySQL 8.0 or MariaDB 10.11 |
| Required plugins | Secure Custom Fields 6.9.7, Action Scheduler 4.2.0, MCP Adapter 0.7.1, and Polylang 3.9 only when the app uses `locales` |
| Standalone target | PHP 8.2 with `pdo_sqlite`, `mbstring`, `json`, `gd` and `fileinfo` |

`zero build --target wp` downloads the required plugins at their pinned
versions, verifies their checksums, and ships them next to yours. The runtime
refuses to boot on a site that misses any of them and names each one;
`zero doctor <project> --wp --site <url>` prints the same table from your
terminal.

## What's in the box

- **Collections, relations, globals**, Drizzle-style, with Drizzle 1.0's
  relational `findMany`/`findFirst` filters in hooks and actions.
- **Hooks and actions** written in a checked subset of TypeScript and compiled
  to PHP. Anything outside the subset fails the build at `file:line:col` with a
  fix.
- **Access rules** per collection, per action and per field, as roles or
  functions; a collection's read, update and delete rules can return a filter
  instead of a boolean. `showIf` drives conditional fields in the editor.
- **Authentication**: sign-in, sessions, roles, and guests who keep their rows
  when they sign up; passkeys and MFA through `zero-identity` on WordPress.
  WordPress users on WordPress; the app's own table standalone.
- **Jobs, webhooks and an outbox**: enqueue from a hook, run after the request
  commits, retry with backoff. Action Scheduler on WordPress, `zero jobs work`
  standalone.
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

A Zero build for WordPress is three Zero plugins, plus the pinned platform
plugins it depends on:

| Plugin | What it is |
|---|---|
| `zero-runtime` | the shared PHP runtime, versioned with the compiler |
| `zero-identity` | accounts, passkeys, MFA and an OpenID Connect issuer |
| `zero-app-<name>` | your app: schema, compiled hooks and actions, MySQL migrations |

Each collection with an editor is a custom post type (`zero_<name>`) with a
Secure Custom Fields group, so your content shows up in WordPress admin with
revisions, and in the block editor when the collection has a `content` field,
next to whatever the site already does.
Collections with `editor: false` are plain tables, and an `auth: true`
collection's rows are WordPress users. Core `/wp/v2` routes and
admin screens for Zero's post types follow Zero's access rules. Need other
plugins at exact versions? [Declare them in the config](docs/wp-plugins.md)
and the build pins and ships them too.

Zero also has a **standalone target**: the same app as a PHP directory over
SQLite, no WordPress. It's the default unless the config says `target: "wp"`
or you pass `--target wp`, and `zero dev` serves it with PHP's built-in
server. Both targets run the same runtime and the same test journey.

## Deploy

Zero apps can be deployed to [Spacefast](https://spacefast.com) natively.

Anywhere else: the WordPress build is `.zero/wp-content/plugins/*.zip`, which
you upload or copy like any plugin. The standalone build is `.zero/app/`: serve
`public/` as the document root, route every request that isn't a file to
`public/index.php` (as `php -S` does and as a `try_files` or rewrite rule does
on Nginx or Apache), keep `data/`, `private/` and `public/uploads/` writable,
and run `php zero/bin/zero.php jobs work` from that directory as a long-lived
process so jobs and webhook deliveries go out (`zero dev` starts it for you).
Any PHP 8.2 host with the extensions listed under [Requirements](#requirements)
runs it.

## Examples

| Example | Shows |
|---|---|
| [`examples/pantry`](examples/pantry) | plain tables, hooks, actions, relations and a background job; the quick start |
| [`examples/blog`](examples/blog) | the CMS tour: field access, sync, members and sign-in, image sizes and private files, jobs and webhooks, translations, with a browser page |
| [`examples/site`](examples/site) | the publication that the system suite drives end to end on both targets |
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
WordPress and standalone, and CI proves it on every change, but
the config API, the wire format and the plugin layout will change before a
first release. There are no binary releases yet; you build the compiler from
source.

Two companion projects are being designed and are **not shipped**: Zero
Blocks (Gutenberg blocks and block themes written in TSX) and Zero Admin (an
optional admin plugin for Zero apps).

## License

Zero is licensed by component, and [`LICENSE`](LICENSE) maps every path.
Everything that runs inside WordPress is GPL-2.0-or-later: the PHP runtime,
the `zero-identity` plugin and the plugins `zero build` emits. Everything else
is MIT: the Rust compiler, the TypeScript client, the `"zero"` types, the
examples, the docs and the tests. Bundled third-party code keeps its own
license; see the `THIRD-PARTY-LICENSES.txt` files under `runtime/`.
