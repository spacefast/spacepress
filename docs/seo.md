# Yoast SEO on TSX pages

First's WordPress adapter supports Yoast SEO Free **28.8 only**. The
`examples/full-site` publication declares that release and its official archive
SHA-256 in `first.config.ts`. Its generated
`first/_generated/wp-plugins.lock.json` records the same pin. API-only apps do
not install Yoast unless they declare it.

The archive is `https://downloads.wordpress.org/plugin/wordpress-seo.28.8.zip`.
Its SHA-256, calculated over the raw ZIP bytes, is
`27cc01cb149db7186ef750552a5cc2ae5028933473886e419918af273b075105`.
The integration is tested with WordPress 7.2-beta5. Jetpack is not the schema
provider for this example. Its schema availability depends on module and
feature gates.

## Metadata ownership

On a claimed TSX route, First emits one `<title>`. With Yoast active, First
reads `YoastSEO()->meta->for_current_page()->title`, decodes its HTML entities,
and escapes the title once. That API returns the presented value with Yoast
variables and `wpseo_title` already applied. First removes only Yoast's
`Title_Presenter`. Yoast keeps its schema and other head presenters.

Yoast emits description, canonical, robots, Open Graph, Twitter, and JSON-LD.
First passes explicit TSX metadata through these filters:

| TSX metadata | Yoast filter |
| --- | --- |
| `title` | `wpseo_title` |
| `description` | `wpseo_metadesc` |
| `canonical` | `wpseo_canonical`, `wpseo_opengraph_url`, and `wpseo_frontend_presentation` for schema IDs |
| `robots.index`, `robots.follow` | `wpseo_robots_array` |
| `openGraph.title`, `description`, `type` | `wpseo_opengraph_title`, `wpseo_opengraph_desc`, `wpseo_opengraph_type` |
| `openGraph.image` | `wpseo_frontend_presentation` sets one image without duplicating native images |
| `twitter.card` | `wpseo_twitter_card_type` |

An item's saved Yoast title, description, canonical and social values override
the matching TSX metadata. Otherwise supplied TSX metadata overrides plugin
defaults. Omitted values, including `undefined`, keep Yoast's defaults.
Layout metadata counts as supplied metadata too. An empty string is a supplied
value, not an omission. A page's robots settings can restrict indexing or
following, but cannot relax a restriction set in Yoast.

First also passes explicit title and description into the schema context, so
WebPage metadata agrees with the visible head. An explicit canonical becomes
the base for Article, WebPage, and BreadcrumbList IDs. Native WordPress
permalinks remain the source for collection links, and omitted canonicals keep
Yoast's choice. A metadata canonical does not change the route or redirect it.
Yoast normally omits its canonical tag on a noindex page.

First's extra `metadata.links` and scripts still appear. Without Yoast, First
keeps its existing title, description, canonical, robots, and social output.
Requests that First does not claim retain their normal WordPress head.

Adding, changing or removing Yoast item metadata purges the affected page.
Changing a code Page's breadcrumb label or Yoast's global settings purges the
site, because those values can appear on dynamic descendant pages too.

## Article eligibility and breadcrumbs

Yoast's default Article type for a custom post type is `None`. An editorial
collection route opts in with `openGraph: { type: "article" }`, as
`examples/full-site/first/app/notes/[slug]/page.tsx` does. The queried object
is the authorized collection post before metadata resolves. First's collection
post types support WordPress authors, and the post needs a nonzero author.
Collection indexables are built for the authorized response through
`wpseo_indexable_forced_included_post_types` and are not persisted, using
`wpseo_should_save_indexable`. Native visibility flags stay unchanged, and
Yoast's head REST endpoint does not become another collection reader. Each
request reads current native content and editor metadata. Collection inclusion
in Yoast sitemaps is outside this adapter's scope.

The adapter preserves an explicit Article subtype or `None` saved in Yoast.

A static TSX Page does not become an Article through this opt-in, even if a
layout supplies the Article card type. Signed-in previews, password-protected
posts, and error responses emit no schema graph. Missing or unreadable items
return a 404 with no stale post context. When a collection's native body is
masked for the visitor, the page still renders with First's safe metadata
fallback and no Yoast output. Yoast's native post readers do not enforce
First's field masks. Other masked fields remain absent from the metadata
function's viewer-bound item.

For collection routes, First adds virtual breadcrumb parents only for real,
published code Pages at URL prefixes. For example, `/notes/hello` gains the
`/notes` parent only when that public code Page exists. Private or missing
parents are excluded. The filter retains Yoast's Home and current-page labels,
including the editor's breadcrumb label. It does not invent an archive or
turn every URL segment into a parent. Yoast's `wpseo_breadcrumb_links` filter
remains available for a site's own hierarchy.

## Verification

Run the real WordPress fixture from the repository root:

```sh
cargo test --test app_router app_router_yoast_metadata_and_schema_on_wordpress -- --exact
```

The fixture installs the pinned plugin and WordPress on SQLite, serves the
compiled TSX pages over HTTP, and parses the head and JSON-LD. It checks
Article and BreadcrumbList, matching canonical IDs, author data, one tag per
metadata family, editor overrides, omitted defaults, a static page, masked
fields, draft and missing routes, fresh metadata after an edit, the head REST endpoint,
a native WordPress post, a classic theme without title support, and the same app
with Yoast deactivated. `tests/php/wp.php` verifies downloaded archives against
their checksums and caches them for later runs. `FIRST_WP_CACHE` can select an
existing test cache.

Multiple SEO plugins and providers other than this Yoast release are outside
this adapter's tested scope. Declare and activate one SEO provider for a site.
