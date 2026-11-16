# Starter: publish from WordPress

An original Zero counterpart of [EmDash starter](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/templates/starter) and [starter-cloudflare](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/templates/starter-cloudflare). Their content schemas, seed, layouts and page handlers were inspected at this exact revision. Upstream's MIT notice is retained in `LICENSE.upstream`; the sample prose and WordPress implementation here are original.

The config defines native post and page collections with block-editor content, SCF excerpts, image and SEO fields, revisions, drafts and editor write access. The small PHP theme queries saved WordPress records on each request. Categories and tags are native WordPress taxonomies attached to the post collection. No frontend build, captured API data, Docker, host PHP, or EmDash service is needed.

From the repository root, with Node.js 22+ and the TypedPress development prerequisites installed:

```sh
# Use an existing matching binary, or build TypedPress as described in the root README.
TP_BIN="$PWD/target/debug/typedpress" node examples/emdash/starter/run.mjs
```

The launcher copies the config into a unique `/tmp/typedpress-emdash-starter-*` project, chooses a free port, runs `typedpress dev --no-watch`, installs the theme, and seeds original posts, an About page, category, tag and editable navigation. It prints the URL, admin URL, project path and exact cleanup command. The disposable site's initial login is intentionally documented: `admin / typedpress-test-admin`. These credentials belong only to that new local site. Existing sites and their credentials are never used. The JSON receipt is also saved as `example.json` in the disposable project; TypedPress owns `.tp/dev/owner.json` there.

Open **Publication posts** or **Publication pages** in WordPress. Change a title, blocks or SCF excerpt, click Save/Publish and reload the public page. Appearance → Menus controls navigation. Appearance → Customize controls the accent and footer; Settings → General controls title and tagline. Native Posts, Pages, Plugins, Media, Settings and other WordPress screens remain available. The optional TypedPress replacement admin is disabled in the config.

| Address | Saved source |
| --- | --- |
| `/` | Latest 10 published collection posts |
| `/posts` and `?page=2` | 20 posts per page, stable date/ID ordering |
| `/posts/{slug}` | Published post blocks, author, date, image, terms and SEO fields |
| `/{slug}` | Published collection page; `/about` is seeded |
| `/category/{slug}`, `/tag/{slug}` | Native assigned taxonomy terms |
| `/search?q=…` | WordPress title/body search over published posts and pages |
| `/rss.xml` | Latest 20 published posts, escaped RSS 2.0 |

Unpublished routes return 404. Anonymous TypedPress reads expose published records; native REST writes require an editor. A nonexistent taxonomy also returns 404. Search and taxonomy filtering run in WordPress queries. Twenty-post pagination is represented with page numbers instead of upstream's opaque cursor. Search uses WordPress's database search, not EmDash's FTS ranking, stemming or live-search component. `/rss.xml` and the accessible persisted light/dark/system switch are useful shared additions here; upstream starter itself does not provide those blog routes/controls.

The installer lives here and is shared by the [blank](../blank/README.md) and [blog](../blog/README.md) examples. It verifies the dev ownership receipt, installs only `typedpress-publication`, and seeds only once. It never deletes native content or unrelated plugins, and never changes an existing password. The theme is installed separately from the generated TypedPress application plugins, following WordPress's native theme boundary. The source theme is `theme/`; the running copy is in the disposable site's `wp-content/themes/typedpress-publication`. After editing the source theme, call `install(project, mode)` from `local.mjs` to copy it again. The launcher deliberately does not run a source watcher.

## Reproduce acceptance

```sh
TP_BIN="$PWD/target/debug/typedpress" node --test examples/emdash/starter/acceptance.test.mjs
```

This creates separate real Studio projects for blank, starter and blog. It saves title, content, SCF fields and an About page through native `/wp/v2` REST, then checks TypedPress reads and freshly served public HTML. It also checks anonymous access, revisions, saved search results, actual taxonomy assignment, uploaded PNG bytes, the 20-post pagination boundary, RSS, a real public comment form submission and native REST approval, saved appearance and content/plugin persistence through a stop/restart. Tests use application passwords generated only inside their disposable sites. An evidence directory printed at startup holds served HTML/XML, receipts and cleanup records; it contains no application passwords.

The test uses Node's built-in runner and the existing TypedPress binary. The optional browser check below uses the shared example Playwright dependency and installed Chromium; it creates its own project and checks native admin Quick Edit and the public UI, theme preference after reload, mobile overflow and search navigation:

```sh
npm --prefix examples/emdash ci
npm --prefix examples/emdash exec -- playwright install chromium
TP_BIN="$PWD/target/debug/typedpress" node --test examples/emdash/starter/browser.test.mjs
```

Both test commands stop their exact `.tp/dev/wordpress` site, delete that exact Studio registration with `--no-files`, then remove their disposable project. Cleanup runs after failures too; cleanup errors fail the run. For a manually launched site, run the exact command printed by the launcher:

```sh
node examples/emdash/starter/run.mjs cleanup /tmp/typedpress-emdash-starter-EXACT
```

The cleanup argument must match that site's ownership receipt. There is no global stop/delete operation.

## Equivalence boundary

The Cloudflare variant has the same publishing model and frontend behavior as starter; this counterpart qualifies those behaviors on local WordPress/SQLite. It does not qualify Cloudflare Workers, D1/R2, caches, PostgreSQL, PortableText, EmDash inline editing, sandboxed plugins or any external provider. WordPress blocks, SCF, native media and native roles supply their corresponding local features. Native WordPress authors supply bylines; this is not EmDash's multi-byline/guest-identity model. Search results include pages as well as posts. The theme has a data-driven sidebar, not EmDash's component/widget configuration runtime. WordPress's native editor/revisions and full admin remain the authoring surface.
