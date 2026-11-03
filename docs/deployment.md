# Deployment preflight and offline recovery

`zero build` produces an artifact. Publishing it to a running WordPress site is
a separate operation. This adapter inspects artifacts and runs **offline local
WordPress workspaces** for backup and recovery qualification. It never serves
traffic, replaces PHP on a running site, adopts an existing Studio installation,
or provisions a host.

Inspect a build with the installed CLI:

```sh
zero deploy inspect --artifact ./app/.zero/wp-content
```

All commands emit one JSON `{ data }` or `{ error }` receipt. `--json` is accepted
for scripts; receipts are always JSON. Failures exit 1. Requires a POSIX system and CLI PHP 8.2+
with SQLite3 and ZipArchive. `php -m` lists extensions. The binary uses
`php` on PATH, or `ZERO_DEPLOY_PHP` when a particular PHP binary is needed.

## Inspect a build before deployment

```sh
zero deploy inspect \
  --artifact ./candidate/.zero/wp-content \
  --baseline ./previous/.zero/wp-content
```

The report includes a SHA-256 inventory digest, total bytes and file count,
plugin names, migration hashes, changed/removed migration history, and pending
migrations. Compiler deployment metadata, when present, adds the schema digest
and the compiler's destructive-change warnings. Older builds report that metadata
as unavailable. Changed schema digests and every pending SQL file need review;
no classification grants permission to execute a migration.

The SQL keyword classifier is conservative advice, not a SQL parser or a proof
that a change preserves data. A changed/removed applied migration is reported as
`history_changed`. Use the compiler's preservation checks and review the actual
pending changes against the destination's native migration ledger. Preflight
never applies SQL or invokes WordPress or uploaded PHP.

`environment` reports generated literal `Zero\Env::get('NAME')` calls and
`['env' => 'NAME']` descriptors, with values always `[redacted]`. Presence means
present in this inspection process's environment. It does not prove presence on
any PHP worker. WordPress configuration constants, dynamically constructed
names, plugin configuration, and external environment stores are outside that
report. Absent names appear in `missingEnvironment`. Artifacts and
backups themselves can still contain literal secrets and must be kept private.

The inventory digest detects byte changes. It is not a signature, a site
ownership claim, or authorization to install the artifact.

## Publish capability boundary

```sh
zero publish --artifact ./app/.zero/wp-content
```

This command **refuses** with `host_capability_missing` and attaches the concrete
preflight report. There is no working network publish endpoint in this adapter.


A qualified host must provide authenticated site/app ownership, an enrolled
publisher signature, durable stage/activate/finalize state, an early admission
barrier, installed-digest attestation and host-acknowledged process **and database
session** drain across the whole topology. A spare DB connection, maintenance
file, successful WP-CLI call, or expired lock is not that acknowledgment. The
offline workspace lock below is local coordination, not the missing live-host
supervisor. Immutable-host rollout, previews with ingress, online migration,
rollback and production recovery remain unsupported. See the
[publish contract](design-pages-and-agents.md#49-build-and-publish-with-hosting-constraints).

## Create a disposable offline WordPress workspace

Start with trusted unpacked WordPress core, SQLite Database Integration, a trusted
WP-CLI phar, and a built artifact. Copying upstream files preserves their license
and copyright notices. The qualified combination is WordPress 7.1.4, SQLite
Database Integration 3.1.2 and WP-CLI 2.12.0. Zero app activation still enforces
its own platform requirements.

For example, use native WP-CLI to obtain a fresh core tree and verify it:

```sh
mkdir -m 700 /tmp/zero-local-recovery
php /path/to/wp-cli.phar core download \
  --version=7.1.4 --path=/tmp/zero-local-recovery/wordpress
php /path/to/wp-cli.phar core verify-checksums \
  --version=7.1.4 --path=/tmp/zero-local-recovery/wordpress
```

Obtain the SQLite plugin from the official WordPress.org release archive
`https://downloads.wordpress.org/plugin/sqlite-database-integration.3.1.2.zip`,
verify its provenance under your normal dependency policy, and unpack it to
`/tmp/zero-local-recovery/sqlite-database-integration`. Keep the downloaded
sources read-only to this workflow. Then:

```sh
zero deploy init \
  --workspace /tmp/zero-local-recovery/original \
  --wordpress /tmp/zero-local-recovery/wordpress \
  --sqlite /tmp/zero-local-recovery/sqlite-database-integration \
  --wp-cli /path/to/wp-cli.phar \
  --artifact ./app/.zero/wp-content
```

The destination must not exist. This creates private local files, config salts,
a SQLite database and a disposable native WordPress administrator. Its random
password is in the workspace's restricted `credentials.json`, never the JSON
receipt. The original sources are not changed. `--artifact` is optional; when
present, only this **fresh** site receives its plugin files. Native WP-CLI
activates dependencies, runtime, identity and app in fresh bootstraps. Plugin
dependency validation and Zero migrations stay with their existing native
owners. Nothing is staged onto an existing site.

Every supported invocation acquires the workspace lock and waits for its WP-CLI
child to exit. The child inherits the lock descriptor. Cron is disabled and no
web server or background runner is started. Installed PHP and WP-CLI input are
trusted local code: do not start servers, detach workers, fork processes or run
another tool against these files. Doing so invalidates the offline contract.
The lock cannot constrain an administrator who bypasses the adapter.

WP-CLI user configuration, packages and caches are isolated to the workspace.
Inherited `WP_CLI_*` variables are removed before workspace settings are applied.
Target overrides (`--path`, `--url`, `--ssh`, `--http`) and aliases are refused,
as are native server and shell commands. Put the native command before its
options (`option get blogname --format=json`); leading global flags are refused.
This is a single-site adapter; network
and multisite administration are outside its scope.

## Native content and diagnostics

```sh
zero deploy wp --workspace /tmp/zero-local-recovery/original -- \
  post create --post_title='Recovery example' --post_status=publish
zero deploy status --workspace /tmp/zero-local-recovery/original
```

The native command receipt returns a private `resultFile`. Read that file locally
to inspect WP-CLI results. Native stdout/stderr can contain data or secrets;
neither is copied to public receipts. PHP subprocesses have a 120-second budget.
`status` reads SQLite without booting application PHP. It reports integrity,
content/user counts, native applied migration IDs, pending/partial migration
state, Zero jobs and Action Scheduler state counts, and redacted failure counts.
It adds no queue, scheduler, worker loop, database schema or publish journal.

An interrupted or failed native command leaves an uncertain operation record.
Later mutations refuse with `operation_uncertain`; status remains available.
No timeout or stale record is treated as permission to replay SQL or an external
effect. Inspect the restricted files and restore a known backup to a fresh
workspace for recovery. Incomplete initialization or restoration is also kept
for inspection, never silently adopted or deleted.

## Back up and restore to another isolated workspace

```sh
zero backup \
  --workspace /tmp/zero-local-recovery/original \
  --output /tmp/zero-local-recovery/recovery.zip

zero restore \
  --archive /tmp/zero-local-recovery/recovery.zip \
  --workspace /tmp/zero-local-recovery/restored \
  --wp-cli /path/to/wp-cli.phar

zero deploy wp --workspace /tmp/zero-local-recovery/restored -- \
  post list --format=json
```

The backup owns the full managed WordPress tree: SQLite's backup-API snapshot,
plugins, core, config, local WordPress media and Zero's local private files.
It includes installed code and configuration metadata, file SHA-256s and native
diagnostics. Process environment values and external services are not included.
The archive deliberately contains secrets, including config salts and identity
material. It is mode 0600 and is never committed, uploaded or printed. Store its
receipt digest separately if you need an integrity check after transport; the
archive's internal hashes are not an authenticity signature or encryption.

The output must be outside the workspace and must not exist. A private scratch
directory is removed on completion/failure. Same-filesystem atomic publication
refuses an existing destination, including a racing writer. A backup is only
reported complete after the SQLite snapshot passes integrity verification.

Restore requires a fresh destination and a private regular archive. It validates
all names, entry types, inventory sizes and hashes before creating the workspace.
Traversal, absolute paths, duplicate names, symlinks, hard-linked source files,
unlisted entries and oversized payloads are refused. Limits are 100,000 files
and 8 GiB expanded data, with metadata limited to 16 MiB. Only files are archived;
empty directories have no durable meaning in this adapter. Output and restored
files stay private. Restore verifies SQLite integrity without executing archived
PHP. Run a native command afterwards only when you trust the backup's origin.

The restored site preserves native IDs, passwords, identity sessions and signing
keys. It gets a new local workspace owner and remains offline at the same
non-routable origin. This is intentional recovery qualification. Publishing a
preview would need separate URL, token/session, mail and worker isolation policy.

An S3 namespace, private-file S3 reference or attachment offload manifest blocks
backup with `provider_backup_unavailable`. Namespace ownership and object
manifests stay in the native database; this implementation does not fabricate a
second manifest or claim that database rows back up provider objects. No S3,
WP Cloud, Studio export/import, MySQL, multi-node drain or cloud-host behavior is
qualified here. Existing Studio sites should use Studio's native export/import
workflow until a dedicated adapter is qualified.

## Verify and clean up

```sh
ZERO_DEPLOY_BIN="$PWD/target/debug/zero" node --test scripts/deploy/artifact.test.mjs

ZERO_DEPLOY_TEST_WORDPRESS=/tmp/zero-local-recovery/wordpress \
ZERO_DEPLOY_TEST_SQLITE=/tmp/zero-local-recovery/sqlite-database-integration \
ZERO_DEPLOY_TEST_WP_CLI=/path/to/wp-cli.phar \
ZERO_DEPLOY_TEST_ARTIFACT=/path/to/built-blog/wp-content \
node --test scripts/deploy/wordpress.test.mjs
```

The WordPress suite downloads pinned upstream sources and builds the blog fixture
with `ZERO_BIN` (default: `target/debug/zero`). The environment overrides above
reuse trusted local sources and a built artifact. Set `ZERO_DEPLOY_BIN` to the
Zero binary to exercise the embedded adapter through the integrated CLI; without
it, the suites run the same PHP entry point directly. It creates isolated sites,
seeds native and Zero content, media and identity, restores a backup, checks
password/session/signing-key continuity through native PHP, and proves clone
independence, refusal and recovery behavior. It removes only its own random
temporary directory, including secret archives. It fails when prerequisites are
missing. Optional `ZERO_DEPLOY_TEST_EVIDENCE` retains restricted failure logs in
that directory; it never retains site databases.

For the manual example, no process needs stopping. After inspecting the exact
paths, remove only `/tmp/zero-local-recovery/original`,
`/tmp/zero-local-recovery/restored` and `/tmp/zero-local-recovery/recovery.zip`
when no longer needed. The adapter has no generic destructive cleanup command.
