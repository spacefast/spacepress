# Upload storage

`uploads` selects one durable backend for the app's private files and standard
WordPress media. Configure it on the server in `defineConfig`; browser clients
keep using `client.files.<resource>` and `client.media`. `file()` and `media()`
references work in both collections and SQL tables, with the same access rules.
The logical file resource and physical provider bucket are different concepts.

```ts
import { defineConfig, env } from "zero";

export default defineConfig({
  name: "catalog",
  uploads: {
    backend: "s3",
    bucket: env("UPLOAD_BUCKET"),
    region: "us-east-1",
    // For Garage, R2, MinIO and other compatible services:
    // endpoint: env("UPLOAD_ENDPOINT"), pathStyle: true,
    prefix: "catalog",
    credentials: {
      accessKeyId: env("UPLOAD_ACCESS_KEY_ID"),
      secretAccessKey: env("UPLOAD_SECRET_ACCESS_KEY"),
      // sessionToken: env("UPLOAD_SESSION_TOKEN"),
    },
  },
});
```

Bucket, endpoint, region and prefix accept strings or `env()` references;
credentials require `env()`. Provision the bucket separately, keep public access
blocked, and grant the runtime GetObject, PutObject, DeleteObject and
ListBucket within its prefix. TLS verification remains enabled. Set credentials
in each replica's process environment or WordPress configuration constants.
Their values never enter generated clients, schema descriptions or provider
error messages. All replicas must share the database and provider configuration.

The transport uses MIT-licensed AsyncAWS S3 3.5.0, scoped as `Zero\Vendor` and
pinned with its dependencies in the runtime Composer lock. `scripts/vendor.sh
runtime` reproduces the committed bundle and licenses. No signer is implemented
in Zero. S3 reads/uploads stream with bounded memory and finite HTTP deadlines;
image processing still needs PHP's normal memory and temporary disk budget.

## Serving and processing

Private files retain their existing MIME/size limits, uploader ownership and
five-minute signed API grants. S3 objects have opaque keys under a random site
namespace and hashed app identity. File rows remain in `zero__files`; attachment
manifests remain in WordPress postmeta. Metadata never depends on a replica's disk.

Media remains publicly readable, matching the existing media API. Its originals,
WordPress intermediate sizes, Zero focal crops, scaled originals and image-edit
backups live in the same backend. Stable API URLs serve those bytes through PHP,
with safe MIME/disposition headers. They can be saved in Gutenberg content without
expiring. They are not public S3 URLs. WordPress responsive-image URLs use the same
manifest, and a deleted/replaced variant stops resolving through the API.

Each request uses a private random directory under the system temporary directory
for upload validation and image processing. The standard WordPress upload,
sideload and attachment metadata hooks offload originals and derivatives before
successful return. Image editing hydrates originals and supporting variants into
that scratch directory. Shutdown removes it, so successful work needs no persistent
uploads volume and another replica can continue immediately.

This covers Zero uploads and WordPress attachment uploads through the standard
core/editor/REST APIs, image generation and image edit/restore. A plugin that writes
directly to disk, bypasses attachment hooks, stores a filesystem pathname as its
own durable record, or replaces upload/image hooks must integrate explicitly.
Unattached arbitrary filesystem uploads, plugin caches, themes and plugin installs
are outside this upload contract. This is not an interception layer for every PHP
filesystem write. Disable external image-CDN plugins when using this backend;
they own separate rewrite/offload contracts.

## Failures and recovery

S3 configuration never falls back to durable local bytes. A failed upload returns
an error. Zero's request transaction rolls back metadata, and new objects have
rollback compensation. Replacements use immutable object keys, so rollback keeps
the previous committed version. Deletions revoke database-backed download URLs at
commit and try provider deletion afterwards. Failed deletes do not resurrect rows.
Provider details and signed requests are excluded from public errors and logs.

A DB-backed Action Scheduler action reconciles one page of at most 100 objects
against live file rows and attachment manifests. It only collects unreferenced
objects older than 24 hours, covering process crashes, rollback cleanup failure
and provider outages during deletion. Database/provider read errors fail the action;
they are never interpreted as an empty reference set. Pagination continues through
scheduled actions; hourly runs retry failures. Run Action Scheduler on a reliable
worker/cron in production. Give each app's requests a deadline below the 24-hour
cleanup grace. Keep the namespace option with database backups. For versioned S3
buckets, provider lifecycle rules must expire noncurrent versions/delete markers.

Core WordPress writes outside Zero's API retain core's own metadata/error lifecycle;
they are not silently wrapped in a new transaction model. Partially completed core
attachment operations can require ordinary WordPress metadata repair. The object
reconciler removes bytes only after their database references disappear.

## Existing data and configuration changes

This release does not migrate an existing uploads directory. Use S3 on a fresh
app, or perform a deliberate migration of local file rows and attachment manifests
before enabling it on an existing site. Reads of unmigrated local resources fail
with `uploads_migration_required`; no durable local read fallback is used and local
bytes are not silently deleted. Keep the existing backend until that migration is
verified. Changing the bucket, prefix, app identity or site namespace also requires
an explicit data migration. No migration history or existing SQL storage is rewritten
by this configuration option.

For local development, `uploads: { backend: "local" }` retains existing disk storage
and private-file web-server protection probes. Omitted configuration retains that
default. Selecting S3 bypasses local `.htaccess` probes; provider authorization and
private API grants protect its objects instead.
