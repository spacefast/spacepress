# Blog: stories, feeds and a useful archive

An original Zero counterpart of [EmDash blog](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/templates/blog), [blog-cloudflare](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/templates/blog-cloudflare), and [demos/simple](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/demos/simple), all pinned to `1824902c0c383c052b623528799427b8a5ff75d0`. Their actual seed schema, page handlers and base layout informed the behavior mapping. Upstream's MIT notice is retained in `LICENSE.upstream`; no upstream seed prose, artwork or infrastructure is copied.

```sh
# Repository root; Node.js 22+ and an existing matching Zero binary.
ZERO_BIN="$PWD/target/debug/zero" node examples/emdash/blog/run.mjs
```

The launcher creates a unique `/tmp/zero-emdash-blog-*` project, chooses a free port, starts native Zero dev/Studio, installs the shared WordPress theme and seeds eight original stories, an About page, editable primary navigation, categories and tags. It prints URLs, the exact project path and cleanup command. Initial local-only login: `admin / zero-test-admin` for this disposable site. It never uses or changes an existing site's credentials.

| Upstream publishing behavior | Zero counterpart |
| --- | --- |
| Live posts/pages with rich content | Native Zero collections, WordPress block editor and SCF; real `/wp/v2/zero_posts` and `zero_pages` saves |
| Homepage and all-posts archive | `/` shows seven newest posts; `/posts` paginates 20 saved posts with `?page=2` |
| Detail and page routes | `/posts/{slug}`, `/pages/{slug}`, seeded `/pages/about`; unpublished/missing entries return 404 |
| Category/tag archives | Native taxonomies, assignment via editor/REST and `/category/{slug}`, `/tag/{slug}` |
| Search | `/search?q=…` queries published WordPress posts and pages; links navigate to their real public routes |
| RSS | `/rss.xml` serves latest 20 posts with escaped title, URL, date and excerpt |
| Image, excerpt and SEO fields | Native uploads/media IDs and SCF; served cards/details reflect saved metadata |
| Bylines, date and reading time | Native WordPress author, stored publication date and content-based estimate |
| Comments | Native approved comments and comment form; pending comments remain hidden |
| Title/tagline, navigation and theme | Native General settings, Menus and Customize accent/footer; light/dark/system preference persists locally |
| Seed and empty states | Original editable stories and About page; queries and empty states remain driven by saved content |

The [shared implementation README](../starter/README.md) explains the native theme boundary, prerequisites and installation. The full WordPress admin remains available, including native Posts, Pages, Plugins and Settings. Edit **Publication posts** or **Publication pages**, save, and reload the public site; no frontend rebuild is needed. The visual design is an original responsive editorial layout with search, cards, reading layout and taxonomy/recent-post sidebar. It is not a screenshot replica.

## Acceptance

```sh
ZERO_BIN="$PWD/target/debug/zero" node --test examples/emdash/starter/acceptance.test.mjs
# Existing site Playwright dependency + Chromium required for this browser check:
ZERO_BIN="$PWD/target/debug/zero" node --test examples/emdash/starter/browser.test.mjs
```

The native acceptance command includes all three publishing counterparts and deletes only their owned sites. Blog's case proves native REST + SCF saves appear publicly; saved taxonomies; real upload bytes and a featured image; the actual 20-post page boundary; RSS after edits; real public comment submission, moderation and approved/pending visibility; draft access and anonymous write denial; saved site appearance; and data plus unrelated-plugin preservation across stop/restart. It prints a `/tmp` evidence directory with served responses and exact cleanup receipts. The browser check drives native admin Quick Edit and public search/theme controls, records desktop/mobile screenshots and cleans up its own site. See the shared README for dependency setup.

Manually launched sites remain running until the exact printed command is used:

```sh
node examples/emdash/blog/run.mjs cleanup /tmp/zero-emdash-blog-EXACT
```

Cloudflare's variant shares the publishing behavior; this qualification is WordPress/SQLite only. It makes no claim about Workers, D1/R2, PostgreSQL, provider behavior or EmDash plugin sandboxing. Native block content replaces PortableText. WordPress search does not reproduce EmDash FTS ranking/stemming or its live-search component. Numbered pages replace opaque cursors. Single native authors replace EmDash's multiple/guest bylines. The sidebar reads live taxonomy and recent-post records; EmDash widget composition, section/newsletter blocks, exact locale formatting and inline editing are not implemented. No newsletter delivery is inferred from a seeded call-to-action. Agents/Abilities and unrelated package demonstrations have their own owners and are not qualified by these publication tests.
