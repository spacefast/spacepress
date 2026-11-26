# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are this package's own.

## [Unreleased]

### Added

- `spLoader(kind)`: a build-time content collection of a SpacePress kind. Entries are the published
  rows an anonymous visitor reads, with media rows, WordPress's rendered HTML for `render()`, and a
  schema and entry type from the site. Each build asks only for the key ranges that changed since
  the last one.
- `spLiveLoader(kind?)`: a live collection with cache hints tagged `<kind>` and `<kind>:<id>`.
- `@spacepress/astro/emdash`: `spEmdash()` runs EmDash's official Astro templates on a SpacePress site with
  no code in the template.
- `spWebhook()`: an Astro endpoint that verifies SpacePress's signed webhooks and invalidates the
  event's tags, or starts a rebuild through `onEvent`.
