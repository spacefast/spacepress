# The examples

The pantry, blog and site examples commit `zero/client/` and `zero/migrations/`
as produced by `zero build`, so a fresh build changes nothing. The showcase
builds its disposable app under `.zero/showcase/`, leaving its sources unchanged.

| Example | What it shows |
| --- | --- |
| [`examples/showcase/`](../examples/showcase/README.md) | One-command seeded demo: native admin, structured fields, SQL relations, media and a compiled class/action |
| `examples/kitchen-sink/` | The playground default: native WordPress posts and users, settings, custom fields, media, translations, hooks and jobs |
| `examples/pantry/` | Plain tables, hooks and actions, plus a background job (`notifyLowStock`) |
| [`examples/subscriptions/`](../examples/subscriptions/README.md) | Owner-scoped subscription tables, renewal actions, an Action Scheduler reminder, and a mobile React SPA, with current gaps documented. [Connect an agent](agents.md). |
| [`examples/stuff-drawer/`](../examples/stuff-drawer/README.md) | Personal inventory and lending log in wp-admin, SCF and Zero Admin; owner filters, agent abilities and overdue stamps, with main's current gaps documented |
| `examples/blog/` | The CMS tour: every phase-2 feature, with a browser page |
| `examples/site/` | The publication that `tests/system` drives end to end |
| `examples/wp-plugins/` | Extra pinned WordPress plugins (see [plugin dependencies](wp-plugins.md)) |
| `examples/recipes/` | Reusable SEO fields imported into a WordPress article collection |

## The kitchen sink

Open the website's `/playground` page to edit this config and browse its generated PHP, SQL and
TypeScript. The “Inside WordPress” buttons show the shared runtime that registers post types and
REST routes, writes posts and users, handles media, and connects custom fields and translations.
Runtime sources and plugin bootstrap templates are labeled separately from generated files.

The example combines pages, events, member profiles, event registrations and an activity log.
It includes options-backed site settings, English/German content, image sizes, private PDF
handouts, a queued activity job and a pinned Classic Editor dependency. Webhooks read
`KITCHEN_WEBHOOK_URL` and `KITCHEN_WEBHOOK_SECRET` from the server environment.

Run a normal example without Docker using `zero dev examples/pantry` or the
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
- **Members:** readers sign in as `members` through the zero-identity screens.
- **Media:** every image gets a 600×400 `card` crop, and slide decks are
  private files (`posts.deck`).
- **Jobs and webhooks:** a reader's comment queues `notifyEditors`, and every
  post change goes out as a signed webhook to `BLOG_HOOK_URL`.
- **Translations:** posts are in English and German.

Build it, turn the generated client into browser JS, build again so the
plugin ships that page, then start the persistent Studio site and
register the page with zero-identity:

```sh
./target/release/zero build examples/blog
node examples/blog/build-client.mjs
./target/release/zero build examples/blog        # ships public/client/ with the plugin
./target/release/zero dev examples/blog --no-watch
./target/release/zero wp --site examples/blog zero identity app add --name=Blog --id=app_blog \
  --redirect=http://localhost:8787/wp-content/plugins/zero-app-blog/public/ --origin=http://localhost:8787
./target/release/zero wp --site examples/blog user application-password create admin zero-sync --porcelain
```

These commands assume Studio printed `http://localhost:8787`; substitute its
actual URL in the registration and sync commands if different. The page is at
`http://localhost:8787/wp-content/plugins/zero-app-blog/public/`.
Its Sign in button goes through the zero-identity screens; it switches between
English and German and takes comments. Send its committed posts to the site with
`ZERO_APP_PASSWORD=admin:<application password> zero sync examples/blog`,
using the password created above. Stop it with `zero dev stop examples/blog`;
the next start retains its content and uploads. Omit `--no-watch` to keep
Zero watching and rebuilding sources in the foreground.

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
