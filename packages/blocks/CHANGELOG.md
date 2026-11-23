# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions
are this package's own and independent of the `spacepress` compiler's.

## [Unreleased]

### Added

- `spacepress-blocks content <file.tsx>`: compile one TSX file to Gutenberg block
  markup, with HTML tags mapped to core blocks, `blockComponent()` and
  `<Block name>` for named blocks, and diagnostics with `file:line:column`.
- Serialization through `@wordpress/blocks` and `@wordpress/block-library` at
  the versions WordPress 7.1 bundles, with every attribute checked against the
  registered block type before `createBlock()`, and the written document read
  back through the same parser: a block the editor would reject or an attribute
  its `save()` does not write is an error, not a silent loss.
