# Try Zero

From the repository root:

```sh
node examples/showcase/run.mjs
```

This builds the current compiler, boots WordPress + MariaDB, uploads an original
cover image, seeds two stories and three linked tasks, and runs a short HTTP
check. Open the printed showcase URL. The page has a five-minute tour, the
actual TypeScript and compiled PHP, and a form that runs a compiled class/action.
Edit the same records in `/zero-admin/`, then refresh the showcase.

Login: **editor** / **zero-test-editor**. Admin is **admin** /
**zero-test-admin** if you want to inspect WordPress itself. These are
intentionally tracked disposable local credentials with no customer or
production access. Application passwords stay in the ignored
`.zero/showcase/receipt.json`; the public page contains none.

The prerequisites are the repository's normal Rust, PHP (including GD), Node,
Docker Compose, Python, curl, sha256sum and rsync toolchain; see
[Contributing](../../CONTRIBUTING.md#toolchain). No front-end install is needed.
The demo binds only to `127.0.0.1:8860`. When using a remote machine, forward
that port in your editor or with SSH.

```sh
node examples/showcase/run.mjs check   # repeat the real HTTP smoke check
node examples/showcase/run.mjs        # rebuild/restart; retain edits while the DB is running
node examples/showcase/run.mjs down   # remove this demo's containers, database and uploads
```

`check` verifies public reads, collection/table relations, editor-only field
masking, anonymous write denial, the compiled class/action, an editor create /
update / delete through the generated client, hook behavior and image delivery.
It cleans up only its own temporary task. This is a smoke check, not a replacement
for the existing compiler, native admin, migration and provider acceptance suites.

All build output and the private copy of the test harness live under
`.zero/showcase/`; existing example snapshots, test fixtures and other Docker
stacks are untouched. Starting after `down` seeds a new database. The database
uses the test harness's tmpfs: restarting its database container loses the data.
The Compose name is unique to this checkout. Use `ZERO_SHOWCASE_PROJECT` and
`ZERO_SHOWCASE_PORT` on the first start to choose a different name and port;
they are saved for subsequent commands. One demo instance per checkout is
supported. A failed first start can also be cleaned up with `down`. If seeding
was interrupted partway through, `down` followed by `up` starts a clean demo.

This demo uses local disk media. S3 is covered separately by the existing real
Garage lane:

```sh
ZERO_WP_PROJECT=zero-showcase-s3 ZERO_WP_PORT=8862 ZERO_WP_REPLICA_PORT=8863 tests/wp/run.sh --s3
```

For compiler examples and formatted TypeScript/PHP comparisons, the existing
website tour and browser compiler are in [`site/`](../../site/README.md).
