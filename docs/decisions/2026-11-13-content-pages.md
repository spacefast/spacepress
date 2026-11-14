# `page.md` is a WordPress Page that the file starts and the site owns

Date: 2026-11-13. Status: accepted. Spec: [rendering.md](../spec/rendering.md) §2
(`about/page.md`: "content-owned: a real WordPress Page"), [spec.md](../spec/spec.md) §1.

## Problem

The spec says what a `page.md` is, and leaves open how the file and the Page relate after the
first build. Three things have to hold at once:

- an editor can change the page in wp-admin, in the block editor;
- a developer can change the file and ship it;
- neither silently destroys the other's work, and a hosted build needs no Node and no PHP.

## Decision

**The file is the Page's first version; after that the Page is the site's.**

- `first build` reads the front matter and keeps the Markdown body as data in the app plugin. It
  converts nothing: the site converts Markdown to block markup with the converter `first sync`
  already uses (`First\Sync\Markdown::toBlocks`), so a page and a synced record are stored the
  same way and the build stays one binary.
- On the first request after a build, the site stores each new file version once, under one lock:
  a new file creates a Page (`post_type` `page`); a changed file updates its Page only while the
  Page still is what the last file version stored. A Page someone edited, trashed or deleted keeps
  the site's version, and the build's change is logged.
- One change does reach an edited Page: when the file newly says the page is not public
  (`status: draft`, or a layout `guard` above it), a published Page takes that status. Its text
  stays the site's and an editor can publish it again. Taking a page away from visitors is the
  code's call, and without this WordPress's REST API and sitemap would keep showing it.
- The site's record of which Page belongs to which route is one option. If it is lost, each Page
  is found again by its `_first_route` meta and adopted as it is: never overwritten, never
  duplicated.
- Nothing is deleted. Removing `page.md` leaves an ordinary WordPress Page behind, at WordPress's
  own address for it.
- The route owns the URL. The Page's permalink is the route's path whatever its slug or parent,
  and WordPress's own address for the Page (`?page_id=`, its slug) redirects to the route.
- The route renders through the app router like a `page.tsx`: the layouts above it, their
  `guard`, `not-found.tsx`, the per-response cache policy and the Markdown twin all apply. The
  page's title and description come from the stored Page, so an editor's change to either shows.

**Front matter is closed.** `title`, `description`, `status` (`published` or `draft`),
`canonical` and `robots`. Any other key is a build error at its line. Typed custom fields belong
to a kind (a `collection()` with `sync`), where they have a schema, an editor field and a place in
the typed client; a Page has none of those, so `page.md` does not invent a second field system.

**Who sees a Page** is WordPress's answer plus the route's:

| Stored status | Anonymous visitor | Someone who may edit the Page |
|---|---|---|
| `publish` | the page, cacheable | the page |
| `private`, under a layout `guard` | the login page | the page, once the guard admits them |
| `draft`, `pending`, `future`, `private` set in wp-admin | 404 | the page, uncached |
| password set in wp-admin | the title and a notice, never the body | the page |

A page under a layout `guard` is stored `private`, so core's own public surfaces (REST, search,
sitemaps, feeds, `llms.txt`) never list what the route protects. A password locks the body for
every visitor without edit rights, cookie or not: an app page is cached for all anonymous
visitors, so it must not show an unlocked body to one of them.

## Alternatives not taken

- **Convert at build time and render the build's markup.** Nothing to store, but then the page is
  not a WordPress Page and nobody can edit it in wp-admin, which the spec rules out.
- **The file always wins.** Every deploy would overwrite an editor's work.
- **Two-way sync through `first sync`.** That is the right tool once built-in kinds land
  (`wp.pages` with `sync`): a `page.md` Page is an ordinary Page record, so it can be synced like
  any other without changing this design. Until then the file changes a Page only while the site
  has not.

## Cost

- A change to a file whose Page was edited on the site does not show until someone applies it by
  hand. The log names the file.
- The first request after a build stores the changed pages; a site with hundreds of `page.md`
  files pays that once per build. Many Markdown files belong in a synced kind instead.
- The converter decides what Markdown can say. Raw HTML in a `page.md` is stored as text.
