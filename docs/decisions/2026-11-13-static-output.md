# Static output: prebuilt pages next to SSR pages, and a static export

Date: 2026-11-13. Status: accepted. Spec: [rendering.md](../spec/rendering.md) §6.1 and §7,
[spec.md](../spec/spec.md) §7 ("Pages with no request data, prerendered to HTML plus `.md` … served
by the engine before WordPress boots"). Builds on the
[cache policy per response](2026-11-12-cache-policy-per-response.md), which deferred prebuilt pages.

## Problem

First wants three ways to serve `first/app/`, side by side with Astro's:

1. prebuilt pages next to server-rendered ones on the same WordPress (Astro's hybrid);
2. a whole site exported to static files, with no WordPress at runtime, its content from
   `first/content/` (Astro's `output: "static"`);
3. the same export with WordPress as the CMS somewhere else: editors work on a hosted site, the
   export reads it, and publishing triggers a rebuild (Astro with a headless CMS).

The cache-policy record deferred (1) because the compiler can't prove a route is
viewer-independent. Dynamic pages must stay server-rendered under that policy.

## Decision

### Words: Astro's

- `defineConfig({ output: "server" | "static" })`, default `"server"`.
- A page may export `prerender = true | false`. In `"server"`, `true` prebuilds the page. In
  `"static"`, every page is prebuilt, and `prerender = false` is a build error that says to switch
  `output` back.
- A dynamic page that does not serve a kind's `url` exports
  `async function staticParams(): Promise<StaticParams<"route/id">>`, one params object per page
  to build. It is Astro's `getStaticPaths` and Next's `generateStaticParams`. We call it
  `staticParams` because it returns params only: the page reads its own data as it does when
  server-rendered, so there are no `props` to pass. Its return type is checked against the route's
  folders at build time.
- A page whose folders serve a kind's `url` (`notes/[slug]` for `url: "/notes/:slug"`) needs no
  `staticParams`. It is built once per item of that kind that a signed-out visitor may read.

### What a prebuilt page is

**An anonymous visitor's render, through the real compiled renderer.** That is the render the cache
policy already shares through Batcache and the edge. Every read in it is bound to the visitor
(`Seam::asViewer`), so no proof that the page is viewer-independent is needed: the file is what any
signed-out visitor would get.

What the build refuses, each as an error at the page with the fix:

| A prebuilt page that… | Why | Fix in the message |
|---|---|---|
| sits under a layout `guard` | one file can't be shown to some visitors and not others | move it out, or don't prebuild it |
| exports `search` | a file has no query string | remove `search`, or don't prebuild it |
| has a `[param]` and neither serves a kind's `url` nor exports `staticParams` | the build can't list its URLs | export `staticParams` |
| exports `staticParams` without a parameter, without `prerender`, or while serving a kind's `url` | it would do nothing | remove it, or add `prerender` |
| exports HTTP handlers, in `output: "static"` | a static site has no server | move the work into an action |

What the export refuses when it renders, with the page's URL and route file:

- a page that calls a viewer function (`is_user_logged_in`, `get_current_user_id`,
  `current_user_can`): its file would show the signed-out answer to everyone;
- a page whose render failed (a 500) or redirected;
- a link to a URL on the same site that the export doesn't contain (a server-only page, the
  WordPress sign-in or comment form): see "What a static page may do".

### How pages are rendered: over HTTP, through the router

Both the hybrid's regeneration and the export fetch each URL from a running WordPress with one
extra request header, `X-First-Prerender`. Its value is `<expiry>.<HMAC of the path and expiry>`,
keyed by the site's runtime secret and valid for an hour. The hybrid's loopback also sends a
`wordpress_`-prefixed cookie, which Batcache and edge caches pass through, so a stored copy never
answers it. The router answers such a request:

- as a signed-out visitor, whatever cookies arrive, `private, no-store`;
- recording the rows the render read in the cache's `first__app_reads` index, so a later write
  knows which prebuilt URLs it changed. That includes the item a kind URL names, so a write to any
  of its fields counts, not only to the fields core's post hooks see;
- with `X-First-Prerendered: 1`. A response without it, such as a cache's stored copy, is never
  written to a file;
- with `X-First-Prerender-Refused` naming a viewer function the render called.

`GET /__first/api/v1/prerender` lists the URLs to build, as the site sees them now. Its answer
holds:

- each prebuilt route's URLs: a literal path, a kind route's items readable by a signed-out
  visitor, and the params `staticParams` returns, run as a signed-out visitor;
- the redirects from each listed item's old URLs (core's `_wp_old_slug`) to its current one;
- the app's build hash.

It needs the same credentials as `first sync` and `first pull`: an editor's application password
(`FIRST_APP_PASSWORD`) or a token (`FIRST_TOKEN`).

### (1) Prebuilt pages in `output: "server"` (the hybrid)

- Files live in `wp-content/cache/first-prebuilt/<build hash>/` (filter `first_prebuilt_dir`):
  `<path>.html` and `<path>.md`. Content is the site's, so the files are made on the site, not by
  `first build`, which has no content.
- After a build is initialized, a stock Action Scheduler action (`first_prebuild`) renders every
  listed URL by loopback with the prerender header and writes its files. No cron, tick or worker of
  First's own.
- The runtime serves a file when the app plugin loads, before `init`, before rewrite rules, the
  query and the theme. It does that only for a GET or HEAD with no query string and no signed-in,
  comment-author or preview cookie, and with the cacheable policy's `Cache-Control`. Anything else
  falls through to the router, as before.
  - Nothing is served while the site hides itself from the public: `blog_public` below 0, or
    WordPress.com's coming-soon options set. Another plugin that gates the site (membership,
    private site) says no through the `first_prebuilt_serve` filter.
  - Only the spelling a file was written under is served: `/%61bout` is not `/about`.
  - A host whose web server can serve files before PHP may serve the same directory, since its
    layout is the URL's path. It must then apply its own access gates first.
- **On-demand regeneration (ISR).** A committed write that would purge a prebuilt URL deletes that
  URL's files at once and schedules `first_prebuild` for it.
  - Such a write is a First write that read the row or listed the kind, or a WordPress post or term
    write whose purge list names the URL.
  - Until the action has run, the URL falls through to SSR under the cache policy, so a visitor
    doesn't see content older than such a write.
  - A render that started before the write is not written. The check reads the write marks from
    the database, not the object cache, and runs again just before the rename.
- **What no write announces.** An option a page reads, a menu, another plugin's data or the time can
  change without naming any URL.
  - A file is never served past an hour (`MAX_AGE`), and the action rebuilds every file after 45
    minutes, so a file is replaced before it expires and such content is at most an hour old.
    Batcache's window is five minutes.
  - Site-wide settings drop every file at once: the site's name and tagline, `blog_public`, the
    language, permalinks, the theme and its settings, menus, and plugin or core updates.
- **Paths that stop being listed.** A path `staticParams` stops listing, or an item that is
  unpublished, loses its files at the next build.
- Markdown twins: the `.md` file is written with the HTML and served from the same lane, so
  `/about.md` stays correct. The sitemap and `llms.txt` stay the router's: they list the same URLs
  whether or not a page is prebuilt.
- **The build directory.** It is named by a hash of:
  - the app's compiled files;
  - the runtime's content hash, stamped into `first-runtime.php` at build time;
  - the WordPress, theme and active-plugin versions (network-activated ones too), must-use plugins
    and drop-ins, which write the page's head and asset URLs.

  The id is kept in an autoloaded option and computed again only when the files' sizes and times
  or those versions change, so the file lane costs one option read and one `stat`.

  A new hash starts an empty directory, so files from an older build or an older WordPress are
  never served. The first `first_prebuild` run under a new hash removes the other directories.
  These files are a cache, not data.
- **A site that can't reach its own address.** The action stops at the first failed fetch and
  backs off (60 s, doubling up to an hour) before the full build runs again.
- Dynamic pages that don't say `prerender = true` are unchanged: SSR under the cache policy.

### (2) and (3) The static export: `first export`

`first export [dir] [--out dir] [--site url] [--base /path] [--site-url https://…]`, a command of its
own. `first build` stays offline and needs no PHP; an export needs a WordPress and content. It
needs `output: "static"`, and writes `first/dist/static/` by default:

| File | From |
|---|---|
| `index.html`, `<path>.html` | each listed URL, rendered |
| `index.md`, `<path>.md` | its Markdown twin (rendering.md §5) |
| `404.html` | `not-found.tsx` (or WordPress's 404) |
| `sitemap.xml`, `llms.txt`, `robots.txt` | the exported pages, with `--site-url` as their origin |
| `_redirects` | kind-URL redirects, one `from to 301` line each (Netlify and Cloudflare Pages read it), plus an HTML page at each old URL whose `<meta http-equiv="refresh">` points on, for hosts with no redirect rules (GitHub Pages) |
| `wp-content/…`, `wp-includes/…` | every stylesheet, script module, image and font the pages reference, at the path WordPress serves it from. That includes the Interactivity API runtime, the router and the compiled client-component stores, so they load from the export. App assets are content-hashed by name, and core's files by their `ver` |

A page at `/docs/intro` is `docs/intro.html`, which GitHub Pages, Cloudflare Pages, Netlify and
`serve`-style servers all answer at `/docs/intro`. The export keeps First's URLs without a trailing
slash. Same-site URLs in the HTML become root-relative, under `--base` when the site is served below
a path (a GitHub Pages project site). `<link rel="canonical">`, the sitemap and `llms.txt` use
`--site-url` when it is given. WordPress's head links to things a static site doesn't have (feeds,
the REST API, RSD, oEmbed, the shortlink, the generator tag) are left out of an exported page.

**(a) Local content** (no `--site`): the export builds the project, starts a throwaway WordPress
on SQLite through the same Studio runner `first dev` uses, and seeds it with `first/content/` the
way a publish seeds a Space (`wp first seed`). It renders every listed URL and deletes the site.
`page.md` pages are stored on the first request, as on any site.

**(b) A hosted WordPress as the CMS** (`--site https://cms.example.com`): the export lists and
renders the URLs on that site, with `FIRST_APP_PASSWORD` or `FIRST_TOKEN`. Editors' published
content is what a signed-out visitor sees there now. The site must run the build this checkout
makes: a different build hash is an error that says to deploy first. That keeps the exported pages
the checkout's own code. The site's `webhooks` config fires on publish, and a CI job that runs
`first export --site …` and uploads the folder is the rebuild.

### What a static page may do

| | (a) local | (b) `--site` |
|---|---|---|
| Links, `<Link>` navigation (the router region) | yes | yes |
| A client component's local state | yes | yes |
| A client component's action call | refused: no server | goes cross-origin to the site's action endpoint, `access: "anyone"` actions only. An action with any other access is refused, because the visitor isn't signed in there |
| Comments, sign-in | refused: the export finds a link to a URL it doesn't contain | comment forms and sign-in links point to the hosted site. The visitor finishes there, on WordPress, signed in there |
| Guarded pages | refused at build | refused at build: one file is the same for every visitor |

Each refusal is an error with the page, the route file and the fix.

## Measured: time to first byte for one page

`/about` of `examples/full-site` (`prerender = true`, a layout and an imported stylesheet and
image), 2026-11-14.

Method:
- The site ran on the WordPress test stack (`tests/wp/harness.sh up`, port 8874): Apache with PHP
  8.5 and OPcache, MariaDB 11.4, WordPress 7.1.4 and the pinned platform plugins, in Docker on one
  host (Intel Core i7-13700, 24 threads).
- Batcache 1.5 ran on an APCu object cache. Batcache takes its window from the last `max-age` in
  `Cache-Control`. When this was measured, First's header put `max-age=0` last, so the benchmark
  pointed Batcache at `s-maxage`. Main now orders the header so Batcache reads `s-maxage` unchanged
  (#390).
- The client opened a new connection for each GET, from the same host, with no cookies. It took
  the time from sending the request to the first byte of the response.
- Each case had 20 warm-up requests, then three runs of 200 sequential requests. Below is the
  median of the three runs' medians, and the highest p95 of the three.

| Case | What answers | Median TTFB | p95 |
|---|---|---|---|
| SSR, uncached | WordPress boots, the router renders the page | 71.7 ms | 138.8 ms |
| Prebuilt (hybrid), Batcache off | the app plugin serves the file at `plugins_loaded`, before the request is parsed | 17.6 ms | 35.8 ms |
| SSR from Batcache | `advanced-cache.php`, before plugins load | 2.4 ms | 9.0 ms |
| The same HTML as a file from Apache | no PHP (what `first export` gives a static host) | 0.7 ms | 4.5 ms |

Measured again after #398 and #416 merged, on main at `29bc393bf`, the same way, on the same
host. The differences from the first run: a fresh stack, and stock Batcache 1.5, unmodified,
because main's header order lets it read `s-maxage` directly. The machine was also less loaded,
so every case is faster. The order and the ratios of the first run hold.

| Case | Median TTFB | p95 |
|---|---|---|
| SSR, uncached | 32.4 ms | 48.6 ms |
| Prebuilt (hybrid), Batcache off | 12.3 ms | 19.6 ms |
| SSR from Batcache | 0.7 ms | 1.0 ms |
| The same HTML as a file from Apache | 0.3 ms | 1.0 ms |

What this means:
- A prebuilt page is 2.6× to 4× faster than an uncached render (32.4 / 12.3 and 71.7 / 17.6).
- Batcache, where it runs, is faster still, because it answers before any plugin loads.
- So the hybrid's prebuilt files matter most where they serve:
  - the first request after a deploy or an edit, which Batcache would render uncached and which a
    prebuilt file answers at once;
  - hosts without a full-page cache;
  - a host that serves `wp-content/cache/first-prebuilt/` itself, before PHP, at the static-file
    speed in the last row.
- The edge cache is unchanged: prebuilt answers carry the same `Cache-Control` as a cacheable render.

## Alternatives not taken

- **Prebuilding in `first build`.** The build has no content and no PHP. Rendering needs both, and
  the hybrid's content changes after deploy anyway.
- **Rendering the export in Rust.** Pages are compiled to PHP; a second renderer would drift from
  the one visitors get.
- **Pulling content into a local site for (b).** Only synced kinds travel through the sync API.
  Media, menus, comments and non-synced kinds would not. Rendering on the hosted site uses all of
  it, and the build-hash check keeps the code the checkout's.
- **`first build` with `output: "static"` writing the export.** It would make `build` need
  WordPress, Node and network access for every static app. It would also change what a build
  writes depending on a config key the hosted pipeline also compiles.
