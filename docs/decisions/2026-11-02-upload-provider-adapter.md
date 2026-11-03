# Keep upload identity in Zero and reuse a PHP S3 SDK

Private files and WordPress attachments must survive replica replacement while
retaining owner grants, stable editor URLs and database rollback behavior.
Originals, derivatives and edit backups need the same durable backend.

We chose the maintained AsyncAWS S3 SDK behind a small byte transport adapter.
The SDK owns signing, protocol and streaming. Zero keeps metadata in existing
file rows and attachment postmeta, with immutable objects and after-commit
deletion. Composer locks and scoped vendoring make the dependency reproducible.

Human Made S3 Uploads and WP Offload Media Lite offer mature attachment offloading,
including private variants and remote image handling. Their existing mutation,
URL and deletion lifecycles would need replacement or coordination with Zero's
transactions and private file grants. We accept maintaining the WordPress hook
adapter and explicit integration boundaries for third-party uploads. Existing
local uploads also need a deliberate migration. The pinned API assessment and
setup requirements are in [Upload storage](../uploads.md).
