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
target/debug/zero build tests/wp/app --target wp
tests/wp/harness.sh up --wp-content "$PWD/tests/wp/app/.zero/wp-content"
tests/wp/harness.sh wp plugin list
tests/wp/harness.sh down
tests/wp/run.sh
```

`up` prints one JSON receipt with the URL, versions, app slug and application
passwords for the four test users. `ZERO_WP_PORT` defaults to 8790. The canonical
`plugins/` directory is bind-mounted; `run.sh` stages a stable copy so later
build publication cannot orphan the mount. Apache and WP-CLI use the invoking
user's UID/GID so installation preserves writable host ownership across runs.
Dependencies activate before runtime,
identity and app. The identity placeholder is replaced by the identity lane;
the harness registers `app_zero_dev` with the local `/auth/callback` redirect
when its CLI is present, and includes `identity.clientId` in the receipt
(`identity: null` with the placeholder). HTTP identity callbacks are enabled only
in this disposable development stack.
