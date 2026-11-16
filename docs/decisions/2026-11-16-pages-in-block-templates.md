# Pages in block templates

Issue: [#497](https://github.com/spacefast/zero/issues/497) ("finish generated theme templates
through standard WordPress template rendering and Site Editor").

## Problem

`first/app/` pages printed their own document. `AppRouter::document()` wrote the DOCTYPE, the
head, `wp_head()`, the root layout, the page and `wp_footer()`. The active block theme was
active, but none of it showed on these pages: not its templates, not its header and footer
parts, and not anything the owner changed in the Site Editor. The 404 and sign-in pages were
code only. An owner could not change their text without a developer.

[design-blocks.md](../design-blocks.md) had kept blocks out of First core. The owner withdrew
that ruling: "Ignore my earlier rulings. Let's do what's best for most WordPress compatibility
while keeping everything." A first plan added a switch between "document" and "theme" rendering.
The owner replaced it with one mode.

## Decision

**One mode: a WordPress block template always wraps a `first/app/` page.**

- **The page is a block.** `first/page` ("Page content") is a dynamic block. While a request
  renders, it prints the HTML the router produced for that address. That HTML is the page inside
  its layouts, with the router region around it. In the editor, the block shows a placeholder.
- **First registers templates** with `register_block_template()` (WordPress 6.7+; checked in
  7.2-beta5), under the `first` namespace. They appear in the Site Editor and in REST
  `/wp/v2/templates`, and an owner can edit and reset them like any template:
  - `first-page`: the theme's `header` part, the page, then the `footer` part. This is the
    default.
  - `first-blank`: the page alone. It replaces "First prints the whole page" for a layout that
    draws its own chrome.
  - `first-login`: wp-login.php's sign-in view.
- **The 404 is the theme's own `404` template.** When the app has `not-found.tsx`, First replaces
  the theme file's content (through `get_block_file_template` and `get_block_templates`) with the
  header part, the page and the footer part. The editor then shows, and resets to, the page the
  app renders. A 404 template the owner saved is a post, and First never touches it.
- **Rendering.** The router still answers on `template_redirect`. It resolves the template by
  slug for the active theme (`get_block_template`), so a saved post wins over the registered one.
  It runs core's `get_the_block_template_html()` and prints the document the way
  `template-canvas.php` does. The page's HTML goes into the block's place after core's template
  filters have run, so texturize, shortcodes and smilies never change compiled output.
- **Choosing a template.** `export const template` on a page or layout: `"theme"` (the default),
  `"blank"`, or a template's slug. The page's own export wins, then the nearest layout's. A
  template without the page block falls back to `first-page`, and the log says so.
- **Layouts are Astro-like.** They nest by folder and run only for routes under them.
  - Under `first-page`, the theme's header and footer are the site's chrome, so the root
    `app/layout.tsx` does not render. Its metadata and guard still apply. This avoids two headers.
  - The root layout renders when it exports `template` itself, when the route uses another
    template, or under a classic theme.
  - A layout that imports `<TemplatePart>` places the theme's parts itself. It renders in
    `first-blank` unless it exports a `template`.
- **`<TemplatePart slug tagName? className? />`** renders `core/template-part`, so it shows the
  owner's edits to that part.
- **Sign-in.** `login.tsx` is the default content of `first-login`, and the form still posts to
  wp-login.php (docs/decisions/2026-11-15-one-sign-in-page.md).
  - **`first/login-form`** ("Login form") is a dynamic block that renders the same form as
    `<LoginForm />`. An owner can rebuild the sign-in page in the editor without code.
  - wp-login.php renders `first-login` when the app has `login.tsx`. It also renders it once the
    owner has saved a `first-login` template.
  - If the template lacks both the page block and the login-form block, First's default content
    is used, so nobody is locked out.
- **Classic themes.** When the active theme is not a block theme (`wp_is_block_theme()` false),
  First prints the document as before. Hardening's `blockTheme` keeps a block theme active
  unless the owner chose otherwise.

## What stays identical

Data reads, access rules, guards, the cache policy, purge recording and Markdown twins run in the
router before the template, exactly as before. The template adds the theme's markup only.

- **Title.** WordPress writes the `<title>` from the page's metadata (`pre_get_document_title`).
- **Head tags.** The description, canonical and social tags go into `wp_head`.
- **Navigation.** `<Link>` swaps the router region `first/main`, which now sits inside the
  template's `wp-site-blocks`. The theme's header and footer stay on screen.
- **Forms and live regions.** They post and subscribe as before. No new `/__first` URL and no
  fragment endpoint were added: forms move to core's ability run route, and fragments to render
  abilities, in their own branches.

## Not done here

- `packages/blocks` (TSX to block themes) stays paused, with the review findings listed in #497.
- Native WordPress posts (`wp.posts`) and moving the www blog onto them, which #497 also covers.
- One template per route, shown in the Site Editor's page list. Routes share `first-page`, and a
  route that needs its own template names a slug the owner creates.
