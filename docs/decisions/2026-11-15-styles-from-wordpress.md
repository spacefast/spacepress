# Styles come from WordPress: theme.json in code, Global Styles on the site

Date: 2026-11-15. Status: accepted.

## Problem

An app's pages (`first/app/`) need a palette, fonts and spacing that a site owner can change in
WordPress (First Admin's Styles screen, the Site Editor) without a deploy, and that an author can
use from code, with Tailwind if the project uses it. Two questions follow: where those values live,
and how pages read them.

## Rule

1. **Code is the default.** The theme layer is the active theme's `theme.json` (First's
   `first-default` when no installed theme is active, the Hardening `blockTheme` switch), with the
   project's `first/theme.json` merged over it. The app plugin ships that file as
   `first/app/theme.json`; `First\Wp\ThemeStyles` merges it on `wp_theme_json_data_theme`.
2. **The database holds the owner's customizations.** What the Styles screen and the Site Editor
   save is WordPress's Global Styles (the `wp_global_styles` post of the active theme), the user
   layer, which WordPress merges over the theme layer. First adds no option or table of its own.
3. **Pages read WordPress's variables.** A page's document calls `wp_head`, so a block theme's
   global-styles stylesheet prints on every First page: each preset as `--wp--preset--<kind>--<slug>`,
   the owner's values over the theme's, then Additional CSS. The site icon prints through
   `wp_site_icon`. Nothing First-specific is needed for this; the app router lane proves it.
4. **Tailwind reads the same variables.** `first build` writes `first/_generated/theme.css`, a
   Tailwind v4 `@theme inline` block whose values are those variables
   (`--color-primary: var(--wp--preset--color--primary)`). First runs no Tailwind: a project that
   uses it imports the file into the stylesheet Tailwind's CLI reads and imports the CLI's output
   from its layout. Without Tailwind, CSS uses `var(--wp--preset--…)` directly.
5. **The round trip is explicit.** `first styles pull` runs `wp first styles export` on the dev site
   (or an `@alias`) and writes the project's file with the owner's Global Styles merged over it to
   `first/theme.json`. The author commits it; the next deploy starts from what was designed.

## Decisions and why

- **The theme layer, not the default layer.** `wp_theme_json_data_theme` puts the project's values
  where a theme's own would be: the owner's Global Styles still override them, and the Styles
  screen's "reset" returns to the project's values. On `wp_theme_json_data_default` the theme's own
  `theme.json` would win over the project, and on `wp_theme_json_data_user` the project would take
  the owner's place.
- **Database overrides, code defaults, never the reverse.** The owner's edits are data a deploy
  must not erase; the project's file is the starting point a fresh site gets. A pull is how an
  owner's design becomes the new default, chosen by the author, as `first pull` does for runtime
  schema versions.
- **`first dev` does not pull by itself.** The dev site's Global Styles are a scratch design until
  the author decides to keep them. Pulling on every rebuild would rewrite a committed file behind
  the author's back, race the watcher (which rebuilds when `first/theme.json` changes) and copy
  experiments into git. One command after designing is the whole cost.
- **Only settings and styles.** `first/theme.json` refuses templates, template parts and patterns:
  those are a theme's files, and an app that wants them ships a theme.
- **The token sheet uses the theme layer's presets.** It is generated from `first-default` with the
  project's file over it, because that is what the build knows. A preset the owner adds on the site
  has a variable but no token until it is pulled; WordPress's default palette and font sizes keep
  their variables and get no token (Tailwind has its own defaults). WordPress's numeric spacing
  slugs (`20`…`80`) become `--spacing-wp-<slug>` so they don't replace Tailwind's spacing scale.
- **`@theme inline`.** Tailwind v4 inlines the `var()` into each utility instead of copying the
  value into its own variable, so a utility follows the owner's value on the page.
- **The Customizer stays refused.** Block themes need no Customizer: the site identity (title,
  tagline, site icon) is under Settings → General and the Site Editor, and Additional CSS is in the
  Site Editor's Styles. Both already print on First pages. `customize.php` would only add a second,
  classic-theme way to edit the same values.

## Not done

- First runs no Tailwind and compiles no utilities; the project runs Tailwind's CLI.
- First Admin's Settings → General has no site icon or logo field yet; core's Settings → General
  and the Site Editor set them.
