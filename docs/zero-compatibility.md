# Importer coverage

Zero imports declarative schemas from other content systems with
[`zero migrate config`](config-migration.md). A successful import proves that
the candidate compiles. Port the application behavior, copy the data and review
access before calling a site migrated.

Zero uses WordPress posts, metadata, attachments, users, revisions, and plugin
lifecycle. A generated plugin tree does not install WordPress or configure a
third-party plugin's external services. Check the deployed platform requirements
before activating an app.

## Schema importers

| Source | Existing importer | Manual application work |
| --- | --- | --- |
| EmDash | Primitive seed schema declarations | Rich blocks, assets, taxonomies, menus, callbacks, and publication behavior |
| Payload | Primitive collection and field declarations | Hooks, access rules, relationships, uploads, Lexical content, authentication, and IDs |
| Sanity | Primitive document and field declarations | Portable Text, custom objects, references, validation, dataset export, assets, and live queries |

See [config migration](config-migration.md) for each importer's accepted subset.
An old content-model artifact is not a new `zero.config.ts`. The compiler refuses
unknown behavior instead of stripping it from a candidate.

## Executable acceptance

- `cargo test --test config_migrate` runs each importer, builds its output and
  boots the imported apps on WordPress-on-SQLite.
