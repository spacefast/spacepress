# First

**First is a TypeScript framework for building backends, fast.** (formerly Zero v2)

You write one `first.config.ts`. `first build` turns it into
database migrations, REST endpoints, user authentication, a dashboard and a
fully typed client library. First is frontend agnostic: the client is plain `fetch`, so it
works with Next.js, Astro, TanStack Start, or anything else that can call
`fetch`.

First is built on top of WordPress and runs alongside a traditional WordPress
setup. It needs WordPress 7.1+, PHP 8.2+ and a small set of plugins that
`first build` pins for you. First apps can be deployed to
[Spacefast](https://spacefast.com) natively.

It's a new, experimental way of building backends for content and personal
software. The API will move. Read [Status](#status) before you build on it.

## Content first, a database when you need one

A First app has two halves, and each builder always stores in the same place.

**Content** is where a new project from `npm create` starts. A `collection()` is a WordPress post
type, members are WordPress users, uploads are the media library and a
`global()` is site options. They are WordPress's own rows, so wp-admin, the
editor and the plugins a site already runs work on them.

**Database** is the half a project adds. A `table()` is a SQL table of its
own, with typed columns, foreign keys, migrations and a schema check at
deploy. `first add db` writes a starting point into a project.

| | `collection()` | `table()` |
|---|---|---|
| Stored as | WordPress posts and post meta | its own SQL table, `wp_first_<name>` |
| Edited in | wp-admin and the WordPress editor, with drafts and revisions | your app, through the API and the typed client |
| Field types | post meta: text, cast when read | typed columns |
| References | checked by First when it writes | SQL foreign keys between tables |
| Filter and sort on a field | a join on post meta per field, no index on the value | the column itself, no join |
| Use it for | what people write and publish | rows your app filters, sorts, counts and joins |

Post meta has no real column types or foreign keys, and filtering and sorting
on it is slow, so data your app queries belongs in a table. Both halves share the
field builders, access rules, references, hooks, the API and the typed client,
and a table row can belong to a post. See
[Content and database](docs/config-api.md#content-and-database).

## One file in

```ts
// first.config.ts
import {
  collection, table, text, richText, slug, integer, timestamp, media,
  ref, defineConfig, action, db, HttpError,
} from "first";

export const authors = collection({
  name: text().max(80),
  avatar: media({ accept: "image" }).optional(),
}, { title: "name" });

export const posts = collection({
  title: text().max(120),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
  writer: ref(authors).optional(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()),
}, {
  content: "body",
  access: { read: "anyone", create: "author", update: "author", delete: "editor" },
});

export const collections = { authors, posts };
export const stock = table({
  post: ref(posts).optional(),
  quantity: integer().default(0),
});
export const tables = { stock };

export default defineConfig({
  name: "journal",
  collections, tables,
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
$ first build
built 2 collections, 0 globals, 1 hooks, 1 actions -> first/dist/wp-content in 6s
```

| You get | Where |
|---|---|
| MySQL migrations, diffed against the last build | `first/_generated/migrations/0001_init.sql` |
| A typed client: `first.posts.list({ with: { writer: true } })` and friends | `first/_generated/client/` |
| Editor types, so `db` in your hooks knows your schema | `first/_generated/db.d.ts` |
| The API as an OpenAPI 3.1 document, also served by the site | `first/_generated/openapi.json`, `/__first/api/v1/openapi.json` |
| An HTTP API for every collection, global and action, with relations loaded through `with`, over WordPress's REST routes | `/__first/api/v1/...` |
| Sign-in, sessions, roles, guests, passkeys and MFA | the `first-identity` plugin |
| A dashboard: WordPress admin, with a post type and a field group generated for each collection that has an editor | Posts and Authors menus in `wp-admin` |
| Three WordPress plugins plus the pinned platform plugins, as folders and ZIPs | `first/dist/wp-content/plugins/` |

Hooks and actions are compiled, not interpreted. Your `beforeCreate` becomes
plain PHP:

```php
function posts__beforeCreate(\First\JsObject $data)
{
    $__t1 = $data;
    $__t2 = 'title';
    \First\Js::set($__t1, $__t2, \First\Js::trim(\First\Js::prop($data, 'title')));
    if (\First\Js::strictEq(\First\Js::prop($data, 'title'), '')) {
        throw new \First\HttpError((int) 422, 'invalid_input', 'A post needs a title');
    }
}
```

Rust runs at build time only. At runtime it's PHP, with no JS engine and no
Composer.

## Quick start

The [installation guide](docs/installation.md) covers the npm creator, compiler
installer and unsigned Homebrew release tooling, including a local packed-install
test. Public packages and release downloads still need maintainer publication.

Build the compiler from source
with Rust 1.96 (the checkout pins it). Local development needs Node 22+ and
npm; it needs neither Docker nor a host PHP installation. First automatically
runs pinned [WordPress Studio CLI](https://github.com/Automattic/studio/tree/trunk/apps/cli)
2.1.1 to provide WordPress 7.1.4, PHP 8.4 and SQLite Database Integration 3.1.2.
The first start downloads the local environment and required plugins.

```sh
git clone https://github.com/spacefast/zero && cd zero
cargo build --release
./target/release/first dev examples/pantry         # admin / first-test-admin
```

Open the URL it prints. The full WordPress admin is available, including
Plugins and Settings. The foreground command watches TypeScript, config and
public files, rebuilding the app when they change. Ctrl+C stops WordPress;
the database, uploads and other installed plugins remain in
`examples/pantry/.first/dev/wordpress` for the next start. The login above is
for disposable local development only, never production.

`first dev --detach` does the same in the background: it returns once the site
is up, keeps rebuilding on save, and writes its output to
`.first/dev/dev.log`. A coding agent's shell gets that without the flag (the
output is not a terminal and `CLAUDECODE`, `CODEX_SANDBOX`, `AI_AGENT` or
`AGENT` is set, outside CI); `--foreground` keeps the command attached.
`first dev status --json` reports the URL, the port and that process.

To leave the site running without watching, use `--no-watch`:

```sh
./target/release/first dev examples/pantry --no-watch
./target/release/first dev status examples/pantry
./target/release/first wp --site examples/pantry user application-password create admin first-local --porcelain
```

Use the returned application password for API writes. Public reads need no
password. The examples below assume the printed URL is `http://localhost:8787`;
use the actual URL if Studio selected another port. `--port <n>` chooses a
new site's port; an existing site keeps its original port.

Watched saves preserve existing fields and stored values. Removing fields or
changing their types or constraints requires a deliberate migration: stop dev,
run `./target/release/first build examples/pantry` to inspect the generated SQL,
then start once with `./target/release/first dev examples/pantry --allow-destructive`. That flag authorizes the initial apply only;
subsequent watched saves are protected again. Edited or prebuilt migration
history also requires this explicit apply.

```sh
export AUTH="admin:<the application password>"
BASE=http://localhost:8787/__first/api/v1

curl -u "$AUTH" -X POST $BASE/locations -d '{"name":"Fridge","kind":"fridge"}'
curl -u "$AUTH" -X POST $BASE/items -d '{"name":" Eggs ","quantity":1,"locationId":1}'
curl $BASE/shopping_list                          # the afterCreate hook added Eggs
curl -u "$AUTH" -X POST $BASE/actions/consume -d '{"itemId":1}'
./target/release/first doctor examples/pantry --site http://localhost:8787
./target/release/first dev stop examples/pantry
```

`first check` compiles without writing anything; `first build` writes the
plugins to `first/dist/wp-content/` without booting anything. `first add db` adds
SQL tables to a project that has none: an example `first/tables.ts` with a
foreign key and access rules, typed client calls for it, and a note on
migrations. It only creates files that are missing, and leaves the example out
of a project that already has tables. Commit
`first/_generated/migrations/`, `first/_generated/client/`, `first/_generated/db.d.ts`,
`first/_generated/openapi.json` and `first/_generated/wp-plugins.lock.json`; `.first/` is local
build and development state.

Want a seeded app to click through? [The showcase](examples/showcase/README.md)
includes structured fields, collection/table relations, image delivery, a
compiled class/action and a repeatable HTTP smoke check. Its separate
`node examples/showcase/run.mjs` launcher still uses Docker; `first dev` does not.

Working on a project with a coding agent? `first init` writes an `AGENTS.md`
section describing this project, the agent skills and an `.mcp.json` entry for
`first mcp`, which serves the project's schema, compiler diagnostics, First's
documentation and the dev site as MCP tools. To use
your collections and actions from Claude Code, Claude Desktop or Codex, connect
to the site's own MCP endpoint. Both are in the [agent guide](docs/agents.md).

## Use it from a frontend

The generated client is dependency-free, erasable TypeScript over `fetch`.
Copy `first/_generated/client/` into any frontend, or import it by path. To try it against
the `journal` config from the top of this page: stop the pantry site, save the
config as `journal/first.config.ts`, then

```sh
./target/release/first dev journal --no-watch      # builds the client and starts WordPress
./target/release/first wp --site journal user application-password create admin first-client --porcelain
```

Node 22.18+ runs this as-is from the `journal` directory, with the admin
application password from that command:

```ts
import { createClient } from "./first/_generated/client/index.ts";

const first = createClient({
  url: "http://localhost:8787/__first/api/v1",
  headers: { Authorization: "Basic " + btoa("admin:<application password>") },
});

const author = await first.authors.create({ name: "Alice" });
const post = await first.posts.create({ title: "  Hello, First  ", writer: author.id });
console.log(post.slug, post.status);                       // hello-first published
const posts = await first.posts.list({ with: { writer: true }, orderBy: { updatedAt: "desc" } });
console.log(posts[0]?.writer?.name);                       // Alice
console.log(await first.actions.publishedCount({}));        // { count: 1 }
```

Every argument and result is typed from your schema: `with` keys, filters,
`orderBy`, action inputs and outputs. The post is a real WordPress post, so it
is also in `wp-admin` under Posts. Browser apps sign members in with
`first.auth.signIn()`, which goes through the first-identity screens given a
`clientId` and `redirectUri`; see the client's generated README for sessions,
guests and server-to-server auth.

## Requirements

| | Minimum |
|---|---|
| To build | Rust 1.96 (today; see [Status](#status)) |
| Local `first dev` | Node 22+ and npm; Studio supplies WordPress, PHP and SQLite |
| To run | WordPress 7.1, PHP 8.2 with `mbstring`, `gd`, `fileinfo`, `openssl` and `sodium`, and MySQL 8.0, MariaDB 10.11 or SQLite through the [SQLite Database Integration](https://wordpress.org/plugins/sqlite-database-integration/) plugin 3.1.2 |
| Required plugins | Secure Custom Fields 6.9.7, Action Scheduler 4.2.0, MCP Adapter 0.7.1, and Polylang 3.9 only when the app uses `locales` |

`first build` downloads the required plugins at their pinned versions,
verifies their checksums, and ships them next to yours. The runtime refuses to
boot on a site that misses any of them and names each one;
`first doctor <project> --site <url>` prints the same table from your terminal.

## What's in the box

### Content

- **Authentication** through `first-identity`: sign-in, sessions, roles, guests
  who keep their rows when they sign up, passkeys and MFA. Members are
  WordPress users.
- **Media**: named image sizes, focal-point crops, and private file buckets with
  signed, PHP-streamed downloads.
- **WordPress admin for every collection**: a post type with a Secure Custom
  Fields group, revisions, and the block editor when the collection has a
  `content` field.

### Database

- **Tables** with typed columns, unique keys and foreign keys, in MySQL,
  MariaDB or SQLite.
- **Migrations you don't write**: `first build` diffs the schema against the
  last build and writes the SQL to `first/_generated/migrations/`.
- **A schema check at deploy**: every pending change is checked against the
  live rows first. A change that would lose data is refused with the row
  count, and a rename with `.was()` keeps its rows.
- **Transactions**: a request, an action and a job each run in one
  transaction that spans table rows and WordPress content.
- **`first add db`** adds this half to a project: example tables with a
  reference and access rules, typed client calls and a note on migrations.

### Both halves

- **Collections, relations, globals**, Drizzle-style, with Drizzle 1.0's
  relational `findMany`/`findFirst` filters in hooks and actions.
- **Hooks and actions** written in a checked subset of TypeScript and compiled
  to PHP. Anything outside the subset fails the build at `file:line:col` with a
  fix.
- **HTTP routes** on the site's own paths (`GET /api/feed.json`,
  `POST /webhooks/stripe`), with any status, headers and body, access rules or
  an HMAC signature, in one transaction. See [routes](docs/config-api.md#http-routes).
- **Access rules** per collection, per action and per field, as roles or
  functions; a collection's read, update and delete rules can return a filter
  instead of a boolean. `showIf` drives conditional fields in the editor.
- **Jobs, webhooks and an outbox**: enqueue from a hook, run after the request
  commits through Action Scheduler, retry with backoff.
- **WordPress Abilities and MCP**: your collections' reads and writes, actions
  and globals are registered as Abilities and exposed on a named MCP server,
  so agents can use them. Jobs join with `agents: true`; `agents: false` opts
  anything out; uploads stay out.
- **Markdown sync**: `first sync` keeps `content/posts/*.md` and your records in
  step, with a three-way merge and conflict files.
- **Localization** with Polylang: one row per locale, shared fields kept equal,
  a generated `wpml-config.xml`.
- **Migrations in**: `first migrate config` imports EmDash, Payload or Sanity
  schemas, and `first migrate-legacy` moves a site built with the
  [original Zero](docs/migrating-from-zero.md).

## Alongside WordPress

A First build is three First plugins, plus the pinned platform plugins they
depend on:

| Plugin | What it is |
|---|---|
| `first-runtime` | the shared PHP runtime, versioned with the compiler |
| `first-identity` | accounts, passkeys, MFA and an OpenID Connect issuer |
| `first-app-<name>` | your app: schema, compiled hooks and actions, MySQL migrations |

Each `collection(fields, options?)` is a custom post type (`first_<name>`) with a
Secure Custom Fields group, so your content shows up in WordPress admin with
revisions, and in the block editor when the collection has a `content` field,
next to whatever the site already does. A change to a published item can be
saved as a [staged version](docs/staged.md) that visitors don't see, then
compared, previewed, promoted or discarded.
Use `table(fields, options?)` for app data in its own SQL table. Both kinds
support references and one/many relations to either kind, with typed client
queries and target access rules. The registry key supplies the name once:
`shoppingList` stays `first.shoppingList` in the client and stores in
`wp_first_shopping_list`. `userProjection()` in `users` projects existing
WordPress users for auth; it creates no second user table. Core `/wp/v2` routes and
admin screens for First's post types follow First's access rules. Need other
plugins at exact versions? [Declare them in the config](docs/wp-plugins.md)
and the build pins and ships them too.

## Deploy

Deploy to [Spacefast](https://spacefast.com) with `sf publish` from a project
containing `first.config.ts`, or use the hosted MCP publish tool. Spacefast captures
and compiles source on the host. REST endpoints, actions, [HTTP routes](docs/config-api.md#http-routes)
and [TSX pages](docs/pages.md) work on the Space hostname. Realtime is not supported.
See the [Spacefast deploy guide](docs/spacefast-deploy.md) and, for an existing
Space, the [migration procedure](docs/migrating-from-zero.md#migrate-a-spacefast-app).

Anywhere else: the build is `first/dist/wp-content/plugins/*.zip`, which you upload
or copy like any plugin, and `first/dist/wp-content/first-manifest.json` records the
versions and the activation order. Jobs run through Action Scheduler, so make
sure WP-Cron or a real cron reaches the site.

## Examples

| Example | Shows |
|---|---|
| [`examples/kitchen-sink`](examples/kitchen-sink) | the playground default: WordPress pages, events, users, custom fields, settings, media, translations, jobs and plugins |
| [`examples/pantry`](examples/pantry) | plain tables, hooks, actions, relations and a background job; the quick start |
| [`examples/blog`](examples/blog) | the CMS tour: field access, sync, members and sign-in, image sizes and private files, jobs and webhooks, translations, with a browser page |
| [`examples/site`](examples/site) | the publication that the system suite drives end to end |
| [`examples/wp-plugins`](examples/wp-plugins) | pinning extra WordPress plugins from the config |

[`docs/examples.md`](docs/examples.md) walks through each one and how to run it.

## Docs

- [`docs/config-api.md`](docs/config-api.md): the `first.config.ts` API, with its [Content](docs/config-api.md#content) and [Database](docs/config-api.md#database) halves, the enforced subset and the known gaps
- [`docs/examples.md`](docs/examples.md): the examples, how to run each, and the suites that prove them
- [`docs/wp-plugins.md`](docs/wp-plugins.md): declaring and pinning WordPress plugins
- [`docs/services.md`](docs/services.md): native forms, queued email, publication search and Stripe checkout
- [`docs/agents.md`](docs/agents.md): `first init` and `first mcp` for coding agents, and the site's MCP endpoint for agents that use the app
- [`docs/realtime.md`](docs/realtime.md): live updates with `watch`, the change hook and pluggable transports
- [`docs/deployment.md`](docs/deployment.md): artifact preflight and offline WordPress backup and recovery
- [`docs/pages.md`](docs/pages.md): optional TSX routes, layouts and viewer-bound pages, with a complete site example
- [`docs/identity-api.md`](docs/identity-api.md) and [`docs/identity-security.md`](docs/identity-security.md): the `first-identity` plugin
- [`docs/config-migration.md`](docs/config-migration.md): importing EmDash, Payload and Sanity schemas
- [`docs/migrating-from-zero.md`](docs/migrating-from-zero.md): moving a site from the original Zero
- [`docs/runtime-contract.md`](docs/runtime-contract.md): the seam between compiler output and the PHP runtime
- [`docs/api-cutover-0.3.md`](docs/api-cutover-0.3.md): what a host and its clients see change moving from the 0.3.0 API to `/__first/api/v1`
- [`CONTRIBUTING.md`](CONTRIBUTING.md): how the compiler works, the test suites, the layout

## Status

Zero, the 0.8 runtime that existing Spaces use, is retired.
Zero 0.9 is its last release apart from security fixes; Zero 0.9 exists to move 0.8 apps to First.
See [migrating from Zero](docs/migrating-from-zero.md).

First is new and experimental. The examples build and run end to end on
WordPress, and CI proves it on every change, but the config API, the wire
format and the plugin layout will change before a first release. There are no
binary releases yet; you build the compiler from source.

Every build ships First Admin, the default admin, at `/wp-admin/new/`; classic
`/wp-admin/` stays complete beside it, and `defineConfig({ admin: false })`
leaves First Admin out. Its source is under `runtime/admin/`; see
[`docs/admin.md`](docs/admin.md).

Pages are an optional TSX front end under `first/app/`: layouts, pages,
`"use client"` components on the Interactivity API, stylesheets and HTTP
routes, compiled to PHP and rendered by WordPress as the visitor.
[`examples/full-site`](examples/full-site) is a complete site; see
[`docs/pages.md`](docs/pages.md) for the supported subset.

What's next, none of it shipped:

- A website with an interactive config builder that loads your config into
  WordPress Playground, and one-click publish to Spacefast.
- First Blocks: an optional add-on for authoring Gutenberg content and full
  block themes in TSX.

## License

First is licensed by component, and [`LICENSE`](LICENSE) maps every path.
Everything that runs inside WordPress is GPL-2.0-or-later: the PHP runtime,
the `first-identity` and `first-admin` plugins and the plugins `first build`
emits. Everything else is MIT: the Rust compiler, the TypeScript client, the
`"first"` types, the examples, the docs and the tests. Bundled third-party
code keeps its own license; see the `THIRD-PARTY-LICENSES.txt` files under
`runtime/`.
