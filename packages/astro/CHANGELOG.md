# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are this package's own.

## [Unreleased]

### Added

- `tpLoader(kind)`: a build-time content collection of a TypedPress kind. Entries are the published
  rows an anonymous visitor reads, with media rows, WordPress's rendered HTML for `render()`, and a
  schema and entry type from the site. Each build asks only for the key ranges that changed since
  the last one.
- `tpLiveLoader(kind?)`: a live collection with cache hints tagged `<kind>` and `<kind>:<id>`.
- `@typedpress/astro/emdash`: `tpEmdash()` runs EmDash's official Astro templates on a TypedPress site with
  no code in the template.
- `tpWebhook()`: an Astro endpoint that verifies TypedPress's signed webhooks and invalidates the
  event's tags, or starts a rebuild through `onEvent`.
