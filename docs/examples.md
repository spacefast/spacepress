# The examples

The pantry, blog and site examples commit `tp/_generated/client/` and `tp/_generated/migrations/`
as produced by `typedpress build`, so a fresh build changes nothing. The showcase
builds its disposable app under `.tp/showcase/`, leaving its sources unchanged.

| Example | What it shows |
| --- | --- |
| [`examples/showcase/`](../examples/showcase/README.md) | One-command seeded demo: native admin, structured fields, SQL relations, media and a compiled class/action |
| [`examples/drive-store/`](../examples/drive-store/README.md) | Most of TypedPress at once: a used hard-drive shop with a catalog, a fake checkout through a form action, stock rules in hooks, SQL order tables, reviews, an RSS feed, guarded pages, a settings global and TypedPress Admin, with a WordPress test |
| [`examples/reading-list/`](../examples/reading-list/README.md) | Each part of an app once: a collection, a table, owner-scoped access, hooks, an action, a job, a route and two npm packages compiled to PHP |
| [`examples/kitchen-sink/`](../examples/kitchen-sink/README.md) | Community Kitchen, an app that uses every authoring feature, from custom fields, hooks and React Email to guarded pages, Woo checkout and MCP; a test fails when a feature is missing from it |
| `examples/pantry/` | Plain tables, hooks and actions, plus a background job (`notifyLowStock`) |
| [`examples/subscriptions/`](../examples/subscriptions/README.md) | Owner-scoped subscription tables, renewal actions, an Action Scheduler reminder, and a mobile React SPA; owner deletes of referenced rows wait on [#533](https://github.com/spacefast/zero/issues/533), not verified live. [Connect an agent](agents.md). |
| [`examples/pet-food/`](../examples/pet-food/README.md) | Personal pet pantry using stock WordPress, SCF, Gutenberg, and TypedPress Admin; owner-scoped actions and an Action Scheduler shopping list; owner deletes of referenced rows wait on [#533](https://github.com/spacefast/zero/issues/533), not verified live |
| [`examples/home-maintenance/`](../examples/home-maintenance/README.md) | Private home systems, recurring tasks, work costs, and overdue jobs using wp-admin, SCF, and TypedPress Admin |
| [`examples/stuff-drawer/`](../examples/stuff-drawer/README.md) | Personal inventory and lending log in wp-admin, SCF and TypedPress Admin; owner filters, agent abilities and overdue stamps; owner deletes of referenced rows wait on [#533](https://github.com/spacefast/zero/issues/533), not verified live |
| [`examples/drive-locker/`](../examples/drive-locker/README.md) | Owner-scoped drive inventory, health trends, Action Scheduler, typed React SPA and capacity reports; owner deletes of referenced rows wait on [#533](https://github.com/spacefast/zero/issues/533), not verified live |
| [`examples/docs/`](../examples/docs/README.md) | A documentation site: a docs kind synced from a folder of Markdown, navigation, components and highlighted code in Markdown, and a Markdown page, with a browser test |
| [`examples/garden/`](../examples/garden/README.md) and [`examples/astro-garden/`](../examples/astro-garden/README.md) | One plant guide twice: as a TypedPress app with `tp/app/` pages, and as an Astro site reading that app with `@typedpress/astro`; a browser test reads both |
| [`examples/migrate-astro/`](../examples/migrate-astro/README.md) | An Astro site before and after the `typedpress-migrate-astro` skill: what it converted, what it flagged, and a browser test of the result |
| `examples/blog/` | The CMS tour: every phase-2 feature, with a browser page |
| `examples/site/` | The publication that `tests/system` drives end to end |
| `examples/wp-plugins/` | Extra pinned WordPress plugins (see [plugin dependencies](wp-plugins.md)) |
| `examples/recipes/` | Reusable SEO fields imported into a WordPress article collection |

## The kitchen sink

See the [Community Kitchen README](../examples/kitchen-sink/README.md) for routes, source files, and the WordPress test.

Run a normal example without Docker using `typedpress dev examples/pantry` or the
blog commands below. Node 22+ and npm are required; WordPress Studio supplies
PHP, WordPress and SQLite.

The seeded showcase has a separate Docker-based launcher. Start it with
`node examples/showcase/run.mjs`. It prints the local
site and admin URLs. Run `node examples/showcase/run.mjs check` for its HTTP
smoke check, or `node examples/showcase/run.mjs down` to remove the demo stack.

## The blog

`examples/blog` has authors, posts and moderated comments, and on top of
that:

- **Field access:** an author's email is for editors only, and the SEO group
  only shows up for published posts.
- **Sync:** posts sync with `content/posts/*.md`, and two sample posts are
  committed.
- **Members:** readers sign in as `members` through the first-identity screens.
- **Media:** every image gets a 600×400 `card` crop, and slide decks are
  private files (`posts.deck`).
- **Jobs and webhooks:** a reader's comment queues `notifyEditors`, and every
  post change goes out as a signed webhook to `BLOG_HOOK_URL`.

Build it, turn the generated client into browser JS, build again so the
plugin ships that page, then start the persistent Studio site and
register the page with typedpress-identity:

```sh
./target/release/typedpress build examples/blog
node examples/blog/build-client.mjs
./target/release/typedpress build examples/blog        # ships public/client/ with the plugin
./target/release/typedpress dev examples/blog --no-watch
./target/release/typedpress wp --site examples/blog typedpress identity app add --name=Blog --id=app_blog \
  --redirect=http://localhost:8787/wp-content/plugins/typedpress-app-blog/public/ --origin=http://localhost:8787
./target/release/typedpress wp --site examples/blog user application-password create admin typedpress-sync --porcelain
```

These commands assume Studio printed `http://localhost:8787`; substitute its
actual URL in the registration and sync commands if different. The page is at
`http://localhost:8787/wp-content/plugins/typedpress-app-blog/public/`.
Its Sign in button goes through the first-identity screens, and the page takes
comments. Send its committed posts to the site with
`TP_APP_PASSWORD=admin:<application password> typedpress sync examples/blog`,
using the password created above. Stop it with `typedpress dev stop examples/blog`;
the next start retains its content and uploads. Omit `--no-watch` to keep
TypedPress watching and rebuilding sources in the foreground.

## Suites

```sh
cargo test                     # compiler; the pantry and blog examples built and run on WordPress-on-SQLite
tests/php/run.sh               # the PHP runtime, on an in-process WordPress
tests/wp/run.sh                # the runtime on real WordPress (Docker)
tests/system/run.sh            # examples/site on WordPress, a site migration, the blog's sync
```

`tests/system/run.sh` boots three fresh WordPress sites, one at a time:

1. `examples/site`, installed as a site owner would and walked through the
   whole journey, then upgraded, deactivated and reinstalled.
2. A site built with an earlier Zero, moved over as
   [migrating from Zero](migrating-from-zero.md) describes.
3. `examples/blog`, whose committed Markdown posts sync in.
