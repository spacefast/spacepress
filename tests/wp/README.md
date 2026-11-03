# WordPress test harness

The harness runs disposable WordPress 7.1, PHP 8.5 and MariaDB 11.4. It uses the
platform floor pins in `tests/fixtures/platform.json`: SCF, Action Scheduler,
MCP Adapter and, for localized apps, Polylang. Every downloaded ZIP is verified
against its SHA-256. The database lives on tmpfs and `down` deletes its volume.
Credentials in `compose.yml` and `harness.sh` are intentionally tracked disposable
test credentials, scoped only to this local stack; they protect no customer or
production data and may be rotated with the stack.

```sh
cargo build
target/debug/zero build tests/wp/app
tests/wp/harness.sh up --wp-content "$PWD/tests/wp/app/.zero/wp-content"
tests/wp/harness.sh wp plugin list
tests/wp/harness.sh down
tests/wp/run.sh
```

`up` prints one JSON receipt with the URL, versions, app slug and application
passwords for the four test users. `ZERO_WP_PORT` defaults to 8790 and `ZERO_WP_PROJECT` (the compose project) to `zero-wp-test`; give each worktree its own pair to run stacks side by side. The canonical
`plugins/` directory is bind-mounted; `run.sh` stages a stable copy so later
build publication cannot orphan the mount. Apache and WP-CLI use the invoking
user's UID/GID so installation preserves writable host ownership across runs.
Dependencies activate before runtime,
identity and app. The identity placeholder is replaced by the identity lane;
the harness registers `app_zero_dev` with the local `/auth/callback` redirect
when its CLI is present, and includes `identity.clientId` in the receipt
(`identity: null` with the placeholder). HTTP identity callbacks are enabled only
in this disposable development stack.

The same media owner has an S3 lane, using pinned Garage 2.1.0 with a real
S3-compatible endpoint and a fresh second WordPress replica:

```sh
ZERO_WP_PROJECT=zero-uploads-test ZERO_WP_PORT=8792 ZERO_WP_REPLICA_PORT=8793 tests/wp/run.sh --s3
```

`compose.s3.yml` and `garage.toml` deliberately track credentials scoped only to
this disposable provider. They protect no customer data and are removed with
`down`. No provider ports are exposed to the host. `up` provisions the Garage
layout, bucket and dedicated key/grant before activating WordPress plugins.
`ZERO_WP_S3=1 tests/wp/harness.sh s3-setup` repeats this provider-only setup
idempotently; the acceptance lane repeats it after uploads and retains their bytes.
Installing the build, activating plugins and proving provider readiness are
separate steps; the real upload/read/process/delete assertions prove readiness.
The test removes A's uploads,
stops A, then reads and processes media on B with an independent WP volume.
It also runs core image scale/restore, owner denial, rollback, provider outage,
and durable deletion recovery. Cleanup uses `ZERO_WP_S3=1` to include both replicas
and the provider volume. `ZERO_WP_KEEP=1` retains the stack for investigation.
