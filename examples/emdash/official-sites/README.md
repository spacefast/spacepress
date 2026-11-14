# Official EmDash source on First

Run the **actual official `blank`, `starter` and `blog` Astro frontends**, with their original pages, components, styles, TypeScript algorithms, and seed content. Their CMS backend is a compiled First project running in native WordPress Studio.

Upstream: [emdash-cms/emdash](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/templates), commit `1824902c0c383c052b623528799427b8a5ff75d0`. The [MIT notice](LICENSE.upstream) applies to the copied template files. [`upstream.json`](upstream.json) records every original file and its SHA-256, `src/live.config.ts` included; every build verifies those bytes and that each template's `src/` holds nothing else.

The templates run on [`@first/astro/emdash`](../../../packages/astro/README.md#emdashs-official-templates): each `astro.config.mjs` adds `firstEmdash()` in place of EmDash's integration, and that is the only file that differs from upstream. The template's own `emdash` imports read the First app's kinds; there is no adapter code in the template.

Use Node.js 22.23.4 or newer on Linux; the launcher verifies process ownership through `/proc`. From the repository root, with First's native development dependencies installed:

```sh
cargo build --bin first
npm ci --prefix examples/emdash/official-sites
node examples/emdash/official-sites/build.mjs
node examples/emdash/official-sites/run.mjs blank
node examples/emdash/official-sites/run.mjs starter
# Or create the blog, including its original photographs:
node examples/emdash/official-sites/run.mjs blog
```

Each command creates a unique disposable project and prints the frontend URL, native WordPress admin URL, exact ownership receipt, and cleanup command. The initial login, `admin / first-test-admin`, belongs only to that disposable local site. The launcher downloads the blog seed's original photographs and imports them into the native media library. No upstream checkout is needed at runtime.

Clean up using the exact path in the receipt:

```sh
node examples/emdash/official-sites/run.mjs blog cleanup /tmp/first-official-blog-EXACT-SUFFIX
```

The cleanup checks ownership, stops that frontend and native site, removes its Studio registration, and deletes that project. `FIRST_BIN=/absolute/path/to/first` selects an independently built compiler.

## What compiles where

| Source | Compiler and runtime |
| --- | --- |
| Original `.astro` pages, components, styles, and frontend TypeScript, unchanged | Astro 7.4.5 → Node SSR and browser JavaScript |
| `astro.config.mjs` | `firstEmdash()` from `@first/astro`: the template's `emdash` imports read the First site at `FIRST_URL` |
| `first.config.ts`, `first/kinds.ts`: `posts`, `pages`, the `category`, `tag` and `credits` taxonomies and the `widgets` global, and the `readingTime` action | First → PHP in native WordPress Studio |
| `first/backend/reading-time.ts` | The original official reading-time algorithm → PHP; its import and Unicode regex are spelled for First |
| `menus.php` | The one mu-plugin: the `primary` menu location, until First can declare menu locations |
| `seed.mjs` | Test setup: imports each template's seed through the First API |

This does **not** compile Astro into PHP. The frontend and native backend are separate local processes. The original reading-time utility also remains in the Astro frontend; its server action demonstrates the same official algorithm executing as compiled PHP over native HTTP.

## Migrated behavior

| Official template | Working local behavior |
| --- | --- |
| Blank | Original welcome page and admin link, redirected to the full native WordPress admin |
| Starter | Original homepage, post archive/detail, pages, categories, tags, live search, native menus, sidebar widgets, SEO, and site identity |
| Blog | Original featured/latest grid, row archive, article rails and table of contents, bylines, related posts, pages, categories/tags, highlighted search, RSS, comments/replies/moderation, sidebar/footer widgets, responsive layouts, and persistent light/dark/system controls |
| Starter and blog | Native WordPress block/SCF editing reflected on reload, revisions, native media, draft protection, expiring signed saved-draft previews, password-protected content excluded from public reads, native menus, and complete WordPress admin/plugins/settings |

Edit posts and pages in native WordPress. WordPress Settings controls the site title and tagline. Appearance → Menus controls navigation. The widget areas are the `widgets` global, edited in wp-admin. Byline credits are terms of the `credits` taxonomy on posts. Media is served by WordPress, including imported original photographs. Draft previews are First's staged-version preview links, opened on the Astro site with `?preview=`; they bypass caches.

`@first/astro/emdash` maps WordPress's rendered HTML to the Portable Text view the templates read, keeping each block's HTML. Cursor strings carry query offsets; WordPress search replaces EmDash FTS. Original seed content, taxonomy labels, bylines and menus are retained. Fonts retain the original Inter/JetBrains Mono faces and are packaged through Fontsource during the Astro build.

Not covered: the blog's "admin" link in its header shows only for a signed-in user, and a page served by Astro doesn't know who is signed in to WordPress (core accepts the login cookie only with a REST nonce). It stays hidden.

EmDash's inline editor, plugin page-contribution hooks, unsaved collaborative previews, provider infrastructure, and sandboxed workers are outside this migration. The empty body-contribution adapters do not emulate plugin execution. These examples use the native WordPress editor and saved content. They make no Cloudflare/D1/R2, PostgreSQL, or AI-provider parity claim.

## Acceptance

```sh
node examples/emdash/official-sites/check.mjs
FIRST_BIN="$PWD/target/debug/first" node --test examples/emdash/official-sites/acceptance.test.mjs
```

One suite owns the new full-application seam. It builds all three original frontends, creates real native backends, proves blank’s original admin-link navigation, edits through core WordPress/SCF, and checks original public routes, media bytes, privacy, signed previews, live search, and the compiled reading-time action. Blog coverage also checks pagination, parsed RSS, moderated threaded comments and native widget saves. Chromium proves native Quick Edit → original public page, live-result navigation, table of contents, theme persistence and mobile layout. Every run prints an evidence directory with HTML, screenshots, receipts and cleanup audits.
