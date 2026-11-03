# Official EmDash source on Zero

Run the **actual official `blank`, `starter` and `blog` Astro frontends**, with their original pages, components, styles, TypeScript algorithms, and seed content. Their CMS backend is a compiled Zero project running in native WordPress Studio.

Upstream: [emdash-cms/emdash](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/templates), commit `1824902c0c383c052b623528799427b8a5ff75d0`. The [MIT notice](LICENSE.upstream) applies to the copied template files. [`upstream.json`](upstream.json) records every original file and its SHA-256; every build verifies those bytes. The CMS-specific `src/live.config.ts` loader is replaced by the typed adapter.

From the repository root, with Zero's native development dependencies installed:

```sh
cargo build --bin zero
npm ci --prefix examples/emdash/official-sites
node examples/emdash/official-sites/build.mjs
node examples/emdash/official-sites/run.mjs blank
node examples/emdash/official-sites/run.mjs starter
# Or create the blog, including its original photographs:
node examples/emdash/official-sites/run.mjs blog
```

Each command creates a unique disposable project and prints the frontend URL, native WordPress admin URL, exact ownership receipt, and cleanup command. The initial login, `admin / zero-test-admin`, belongs only to that disposable local site. The launcher downloads the blog seed's original photographs and imports them into the native media library. No upstream checkout is needed at runtime.

Clean up using the exact path in the receipt:

```sh
node examples/emdash/official-sites/run.mjs blog cleanup /tmp/zero-official-blog-EXACT-SUFFIX
```

The cleanup checks ownership, stops that frontend and native site, removes its Studio registration, and deletes that project. `ZERO_BIN=/absolute/path/to/zero` selects an independently built compiler.

## What compiles where

| Source | Compiler and runtime |
| --- | --- |
| Original `.astro` pages, components, styles, and frontend TypeScript | Astro 7.3.2 → Node SSR and browser JavaScript |
| `zero.config.ts`, native collections, access controls, and the `readingTime` action | Zero → PHP in native WordPress Studio |
| `backend/reading-time.ts` | The original official reading-time algorithm → PHP; only its imported host type changes |
| `shared/client.ts` and UI adapters | Type-checked Astro adapters; all native JSON is parsed with Zod |
| `bridge.php` | Native WordPress reads, signed draft previews, menus, comments, and Appearance settings |

This does **not** compile Astro into PHP. The frontend and native backend are separate local processes. The original reading-time utility also remains in the Astro frontend; its server action demonstrates the same official algorithm executing as compiled PHP over native HTTP.

## Migrated behavior

| Official template | Working local behavior |
| --- | --- |
| Blank | Original welcome page and admin link, redirected to the full native WordPress admin |
| Starter | Original homepage, post archive/detail, pages, categories, tags, live search, native menus, sidebar widgets, SEO, and site identity |
| Blog | Original featured/latest grid, row archive, article rails and table of contents, bylines, related posts, pages, categories/tags, highlighted search, RSS, comments/replies/moderation, sidebar/footer widgets, responsive layouts, and persistent light/dark/system controls |
| Starter and blog | Native WordPress block/SCF editing reflected on reload, revisions, native media, draft protection, expiring signed saved-draft previews, password-protected content excluded from public reads, native menus, and complete WordPress admin/plugins/settings |

Edit posts and pages in native WordPress. WordPress Settings controls the site title and tagline. Appearance → Menus controls navigation; Appearance → Template widgets controls the imported widget composition. Byline credits are native editable terms on posts. Media is served by WordPress, including imported original photographs. Saved-draft preview links expire after ten minutes and bypass public caches.

The adapter maps WordPress blocks to a Portable Text view for the original templates, with rendered native block HTML preserved. Cursor strings carry native query offsets; WordPress search replaces EmDash FTS. Original seed content, taxonomy labels, bylines and menus are retained. Fonts retain the original Inter/JetBrains Mono faces and are packaged through Fontsource during the Astro build.

EmDash's inline editor, plugin page-contribution hooks, unsaved collaborative previews, provider infrastructure, and sandboxed workers are outside this migration. The empty body-contribution adapters do not emulate plugin execution. These examples use the native WordPress editor and saved content. They make no Cloudflare/D1/R2, PostgreSQL, or AI-provider parity claim.

## Acceptance

```sh
node examples/emdash/official-sites/check.mjs
ZERO_BIN="$PWD/target/debug/zero" node --test examples/emdash/official-sites/acceptance.test.mjs
```

One suite owns the new full-application seam. It builds all three original frontends, creates real native backends, proves blank’s original admin-link navigation, edits through core WordPress/SCF, and checks original public routes, media bytes, privacy, signed previews, live search, and the compiled reading-time action. Blog coverage also checks pagination, parsed RSS, moderated threaded comments and native widget saves. Chromium proves native Quick Edit → original public page, live-result navigation, table of contents, theme persistence and mobile layout. Every run prints an evidence directory with HTML, screenshots, receipts and cleanup audits.
