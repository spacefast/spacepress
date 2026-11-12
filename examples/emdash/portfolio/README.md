# Editable portfolio on First and WordPress

A complete adaptation of the official EmDash **portfolio** and
**portfolio-cloudflare** templates at
[`1824902c0c383c052b623528799427b8a5ff75d0`](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/templates/portfolio).
Their `src/` renderers and seeds are identical at this pin; the Cloudflare
variant adds `worker.ts` and deployment configuration. Both are represented
by this one WordPress implementation. The upstream MIT notice is retained
in [LICENSE-UPSTREAM](./LICENSE-UPSTREAM).

## Run the real site

From the repository root, with the native First development prerequisites installed:

```sh
node examples/emdash/portfolio/dev.mjs
```

This creates a **new disposable project** in `/tmp`, chooses a free port, starts
native `first dev` / WordPress Studio, activates the generated portfolio model and
[frontend plugin](./frontend/portfolio.php), and imports the sample content. It
fetches the original photographs from their URLs in [seed.json](./seed.json),
uploads each to WordPress, and compares the original bytes with the public upload
URL. Internet access is needed for Studio prerequisites and these photographs.
The original image URLs and alt descriptions remain in the seed; photographs
are downloaded at run time, not redistributed in this repository.

The command prints the public URL, native WordPress admin URL, project path, and
an exact cleanup command. Initial **disposable-site-only** credentials are shown
by native First in the evidence directory's `start.log`. No existing site, account,
data directory, plugin, or Studio registration is reused. Studio's full admin,
Plugins, Settings, media library, native editor, and First Admin remain available.

Open `/`, `/work`, `/work?tag=digital`, `/work/hotel-wilde`, `/about`, `/contact`,
and `/rss.xml`. `/home` redirects permanently to `/` and preserves its query.

Stop and delete only the site whose receipt the command printed:

```sh
node examples/emdash/portfolio/cleanup.mjs /tmp/first-portfolio-evidence-EXAMPLE/studio.json
```

The script checks the receipt's disposable path, stops that exact project,
checks it is offline, deletes that exact Studio registration, removes its files,
and preserves `cleanup.txt` and the receipt with `state: "deleted"`. It never
runs a global Studio stop or delete.

`FIRST_BIN=/absolute/path/to/first` selects another existing First binary.
`FIRST_PORTFOLIO_EVIDENCE=/tmp/a-unique-evidence-directory` chooses where receipts,
logs, and per-upload hashes are saved. Use a fresh evidence directory per run.

## Edit the portfolio

Projects are native WordPress posts with First/SCF fields. In WordPress admin,
open **Projects**, edit a title or body, change its cover, disciplines, client,
year, website, gallery, summary, featured flag, or SEO group, then save. These
are the same stored records returned by `/__first/api/v1/projects`; the public
pages read through First's database pipeline with an anonymous Viewer, so a
signed-in editor does not accidentally publish drafts to ordinary visitors.
Authenticated WordPress preview links show the stored draft with a preview
notice and `noindex`; anonymous requests cannot see that draft. Native revisions
remain available. Previewing unsaved block-editor autosaves is not implemented.

Edit **Portfolio pages** for Home, About, Contact, or another slug. Their native
SCF flexible layouts contain Statement, Selected work, Clients and Contact
blocks. The opening Statement/Contact supplies the single page `h1`. Rich text
is native editable WordPress block markup, converted from the pinned Portable
Text seed. A missing/empty Home layout gets a tagline, selected work, and
clients inferred from those projects.

**Portfolio settings** is a native SCF options page: title, tagline, logo,
title separator, social accounts, primary navigation, and footer links. Social
handles become profile links; complete HTTP(S) profile URLs are preserved.
The public shell has Light, Dark, and System controls. The choice persists in
a SameSite cookie and is applied during server rendering.

The generated API and WordPress Abilities remain available to agents. For
example, `portfolio/projects-update` takes `{ id, patch }`, writes through First's
normal permission/validation pipeline, and changes the same public case study.
This example does not implement an EmDash sandboxed Worker or AI provider.

## Executable native acceptance

```sh
node --test examples/emdash/portfolio/acceptance.test.mjs
```

One cross-surface test owns this example's acceptance. It starts its own native
WordPress Studio instance, creates real records from all six official case
studies and three pages, and checks:

- Native PNG generation, REST upload, exact served bytes, and native SCF cover
  replacement; captions, media alt text and public image URLs.
- All six public case studies, About and Contact, gallery output, metadata,
  oldest/next-project navigation, and one `h1` per page.
- Database-level discipline filtering, active and empty states, invalid filters,
  and the thirteen-project boundary across a twelve-row archive page.
- Featured selection, native un-featuring, and the six-newest fallback.
- A real XML parser reading RSS, escaped titles, live native title/summary edits,
  and a native SCF settings change reflected in the feed and public shell.
- Native core REST title/body/SCF/gallery/SEO edits, native SCF flexible layouts,
  native SCF options, native revisions, draft privacy, authenticated preview,
  and a real WordPress Ability mutation reflected in First and public HTML.
- Authenticated native editor, Plugins and Settings access; preservation of the
  existing active plugins and an unrelated plugin added by the test.

The automated acceptance intentionally generates real PNG fixture bytes instead
of depending on a third-party image host. It does not claim those fixture images
prove an external provider. `dev.mjs` exercises the separate original-photo
import path, also with actual uploads and byte comparisons. `uploads.json`
records each successfully verified upload's byte length and SHA-256.

The test always cleans up its own site. For an explicit browser inspection,
set `FIRST_PORTFOLIO_KEEP=1`; then run its printed exact cleanup command yourself.
Evidence includes the `.first/dev` ownership receipt, served HTML/XML, stored
seeded records, native edit results, upload hashes, Ability result, and cleanup
proof. Credentials and evidence stay outside the tracked example.

For browser acceptance, use the site from `dev.mjs`: follow the Digital filter,
open Ola Ceramics, inspect loaded media, use Dark then navigate and check the
choice persists, switch back to System, and check Work and a case study at
390px. The automated suite holds HTTP/storage behavior; this browser pass holds
layout, image loading and the working theme controls.

## Pinned behavior mapping and boundaries

| Pinned upstream owner | First implementation |
| --- | --- |
| [`seed/seed.json`](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/templates/portfolio/seed/seed.json) | `first.config.ts`, adapted `seed.json`, `seed.mjs`: six complete projects, galleries, three pages, four page layouts, menus and settings. |
| [`src/utils/selected-work.ts`](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/templates/portfolio/src/utils/selected-work.ts) | Up to twelve featured published projects, newest first; six newest when none are featured. |
| [`src/pages/work/index.astro`](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/templates/portfolio/src/pages/work/index.astro) | Public index, database `tags.has` filter, empty states, native images, twelve-row offset pagination. Fixed native SCF discipline choices replace EmDash taxonomy administration. Offset pagination replaces EmDash's opaque cursors; it is not stable under concurrent publication. |
| [`src/pages/work/[slug].astro`](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/templates/portfolio/src/pages/work/%5Bslug%5D.astro) | Case-study title, summary, client/year/disciplines, safe website link, cover, block body, numbered gallery with full/half/half rhythm, next-older link, SEO/canonical/OG. |
| [`src/components/PageView.astro`](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/templates/portfolio/src/components/PageView.astro) and `components/blocks/*` | Native flexible layouts, single heading, editable block content, statement/selected work/clients/contact, default Home, missing-content fallback. Missing arbitrary pages use WordPress's 404, rather than EmDash's menu-aware placeholder. |
| [`src/utils/media.ts`](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/templates/portfolio/src/utils/media.ts) | Native attachment IDs, local uploads, alt text, responsive WordPress image markup, absolute OG image URL. External media-provider references are imported, not emulated. |
| [`src/utils/social.ts`](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/templates/portfolio/src/utils/social.ts), `layouts/Base.astro` | Six-network handle/URL normalization, native settings/navigation/footer/logo, accessible persistent appearance controls, responsive editorial layout. Font delivery uses the system sans family. |
| [`src/pages/rss.xml.ts`](https://github.com/emdash-cms/emdash/blob/1824902c0c383c052b623528799427b8a5ff75d0/templates/portfolio/src/pages/rss.xml.ts) | Twenty newest dated published projects, XML escaping, absolute permalinks, Atom self link, RSS MIME type. Revalidation keeps native edits immediately visible. |
| [`portfolio-cloudflare`](https://github.com/emdash-cms/emdash/tree/1824902c0c383c052b623528799427b8a5ff75d0/templates/portfolio-cloudflare) | The same content/rendering contract on native WordPress SQLite. No claim of D1/R2/Cloudflare cache/Worker deployment parity. |

The public renderer is an ordinary WordPress frontend plugin because First's
compiler does not currently expose custom HTML/XML page routes. It uses First's
real database pipeline, not duplicated JSON fixtures or substitute API responses.
No compiler/runtime files are changed. EmDash inline visual editing, portable
content storage, cache invalidation and its infrastructure are not reproduced;
native WordPress/SCF editing, revisions, Abilities, and attachment storage are
the corresponding integration seams here.
