# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions
are this package's own and independent of the `zero` binary's.

## [Unreleased]

### Added

- `zero-blocks build <theme-dir> [--out <dir>] [--zip]` and `zero-blocks check
  <theme-dir>`: a directory of TSX (`theme.config.ts`, `templates/`, `parts/`,
  `patterns/`, `styles/`, `assets/`) becomes a complete block theme:
  `style.css` header, `theme.json` (version 3, validated against the official
  WordPress 7.1 schema), `templates/*.html`, `parts/*.html`, `patterns/*.php`
  (a header comment and markup, nothing executable), `styles/*.json`, and a
  zip. The output directory is replaced whole and the bytes are the same for
  the same input.
- `@spacefast/zero-blocks/theme`: `defineTheme` with typed preset tokens
  (`theme.tokens.color.primary` is the type `"primary"`), `defineTemplate`,
  `definePart`, `definePattern`, `defineStyleVariation`, `preset.*`, and the
  template vocabulary (`TemplatePart`, `Pattern`, `QueryLoop`, the `Post*`,
  `Site*`, `Navigation`, `Comments*` and layout blocks).
- `Block.Core.<Name>`: every core block WordPress 7.1 registers as a typed
  component, generated from the same registry the serializer checks against.
- Theme diagnostics: `index_template_missing`, `unknown_template`,
  `unknown_template_part`, `unknown_pattern`, `query_mode_required`,
  `unknown_preset`, `theme_json_invalid`, `declared_file_missing`,
  `duplicate_slug`, `theme_config_invalid`, and the `unused_part` warning.
- `zero-blocks content <file.tsx>`: compile one TSX file to Gutenberg block
  markup, with HTML tags mapped to core blocks, `blockComponent()` and
  `<Block name>` for named blocks, and diagnostics with `file:line:column`.
- Serialization through `@wordpress/blocks` and `@wordpress/block-library` at
  the versions WordPress 7.1 bundles, with every attribute checked against the
  registered block type before `createBlock()`, and the written document read
  back through the same parser: a block the editor would reject or an attribute
  its `save()` does not write is an error, not a silent loss.
