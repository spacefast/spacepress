# One sitemap, through WordPress core's

Date: 2026-11-13. Status: accepted. Spec: [spec.md](../spec/spec.md) §2.7, §5.

## Problem

A First site has three sources of public URLs: WordPress's own posts, pages, terms and authors;
kinds with a `url` pattern; and `first/app/` pages. Core's sitemap (`wp_sitemaps`) knew only the
first. A kind's post type is registered `public => false` (it stays out of core's public lists and
is `publicly_queryable` instead), so core's posts provider skips it, and core knows nothing of app
routes. Core's posts provider also selects by `post_status = publish` alone: it has no notion of a
First read rule.

## Decision

Keep core's sitemap as the only one and add to it through core's API.

- **One provider, `first`**, registered with `wp_register_sitemap_provider()` on `wp_sitemaps_init`.
  It has a sub-sitemap per kind with a `url` and one for app pages. Core renders the index, the
  files, the stylesheets and the `robots.txt` line; First writes no XML and adds no rewrite rule.
- **Kinds are listed by First's provider, not by making their post types public.** Flipping
  `public` would also put them in core's menus, searches and archives, and core's provider would
  list every published row whatever the kind's read rule says.
- **The rows are the ones an anonymous viewer reads**, selected by the read pipeline
  (`Db::findMany` and `Db::count` with a signed-out `Viewer`), not by a second query that restates
  the rules. A rule that refuses visitors gives the kind no file at all, so the index does not even
  name it. The request's own user never matters: the sitemap is one cacheable document.
- **Password-protected content is left out**, from core's files as well. Core lists such posts; a
  visitor cannot read them, and the brief for this work is "nothing not publicly readable".
- **Authors follow the users kind's read rule** when the app has one: core's users provider is
  narrowed to the users an anonymous viewer may read.
- **App pages reuse `/llms.txt`'s list** (no parameters, no layout guard, renders for a visitor),
  less pages that say `robots: { index: false }` and the home page, which core already lists.
  A route with parameters is listed through its kind when it serves a kind's `url`; other
  parameterized routes have no enumerable set of URLs and are not listed.
- **Front-end modes.** `frontend: false` disables sitemaps (`wp_sitemaps_enabled`). An external
  frontend gets the sitemap from this site with every entry at its own address; this site answers
  the sitemap before its redirect to the frontend, as it answers feeds.
- **One list per kind.** An item is listed when First's read pipeline gives it to an anonymous
  viewer, it is published without a password, every placeholder of its `url` comes from a field a
  visitor may read, and no guarded app page serves its address. A file's count, its paging and its
  entries come from that one list, so no hidden row can add a file or a page. A sitemap request is
  answered as nobody (no user, no post-password cookie).
- **Purges.** A write announces the sitemap index and every file of the sub-sitemap that would
  list the item (as many as the index last showed, plus one). Computing the one file would run the
  read rules inside the write, and depends on rows other readers can't see. A First write to a kind
  with a `url`, or to the users kind, purges them too: it can change who may read a row without
  touching the post.

## Not done

App pages are found by rendering each parameterless page as a visitor, once per sitemap request,
as `/llms.txt` does. A site with very many such pages would want that list computed ahead of time.
Prebuilt pages are on main now ([static output](2026-11-13-static-output.md)), but they don't provide
that list: `First\Render\Prebuilt::urls()` covers only pages that export `prerender = true`, and
computes them on each call. `first export` writes its own `sitemap.xml`; the WordPress sitemap is
unchanged.

Term archives of First taxonomies need nothing here: a `taxonomy()` with a `url` registers as a
public taxonomy, so core's own taxonomies provider lists its terms, at the links its `term_link`
filter builds (docs/decisions/2026-11-11-authoring-surface.md, ruling 30). One without a `url` is
not public and is not listed.
