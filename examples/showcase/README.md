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

The prerequisites are the repository's normal Rust, PHP (including GD), Node
22.18+, Docker Compose, Bash 4+, Python, curl, sha256sum and rsync toolchain; see
[Contributing](../../CONTRIBUTING.md#toolchain). No front-end install is needed.
The launcher checks prerequisites before building or starting containers and
reports unavailable commands, missing PHP GD, and Docker connection failures.
It also rejects an occupied host port before starting a new stack.
The demo binds only to `127.0.0.1:8860`. When using a remote machine, forward
that port in your editor or with SSH.

To open it from another computer on your Tailscale network, expose the existing
loopback server with Tailscale Serve:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8860
ZERO_SHOWCASE_URL=https://your-machine.your-tailnet.ts.net:8443 node examples/showcase/run.mjs
```

Use the HTTPS address printed by Tailscale as `ZERO_SHOWCASE_URL`. The launcher
saves that origin for future starts and configures WordPress images, login and
editor links to use it. The hostname must be reachable from the demo machine
and the computer viewing it. Serve shares only within your tailnet. To remove
this proxy later, run `tailscale serve --https=8443 off`; the demo's `down`
command does not change Tailscale settings. After `down`, supply the URL again
when starting a new demo.

```sh
node examples/showcase/run.mjs check   # repeat the real HTTP smoke check
node examples/showcase/run.mjs        # rebuild/restart; retain edits while the DB is running
node examples/showcase/run.mjs down   # remove this demo's containers, database and uploads
```

`check` verifies public reads, collection/table relations, editor-only field
masking, anonymous write denial, the compiled class/action, an editor create /
update / delete through the generated client, hook behavior and image delivery.
It uploads its own image and creates a temporary published story and task, then
deletes those records and the upload, including on failure. Editing, unpublishing
or deleting seeded stories, changing task links, and removing covers do not break
the check. Original HTTP image bytes must match the upload; the card response must
decode as a 960 × 600 image. `check` needs Node and PHP with GD; it does not rebuild
or reseed the demo. HTTP requests time out after 15 seconds. Cleanup failures
report the record IDs that need attention. This is a smoke check, not a replacement
for the existing compiler, native admin, migration and provider acceptance suites.

All build output and the private copy of the test harness live under
`.zero/showcase/`; existing example snapshots, test fixtures and other Docker
stacks are untouched. Starting after `down` seeds a new database. The database
uses the test harness's tmpfs: restarting its database container loses the data.
The default Compose name is unique to its state directory. Use
`ZERO_SHOWCASE_PROJECT` and `ZERO_SHOWCASE_PORT` on the first start to choose a
different name and port; they are saved for subsequent commands in that state
directory. `down` removes
the saved ownership and application-password receipt only after Compose cleanup
succeeds. Supply custom project/port settings again when starting after `down`.
A failed first start can also be cleaned up with `down`, even if the copied
harness script is missing. Failed cleanup retains ownership so you can retry;
it never reports a stopped stack after a failed Docker command. If seeding
was interrupted partway through, `down` followed by `up` starts a clean demo.
After a successful initial seed, a database marker prevents subsequent starts
from recreating deliberately deleted stories, tasks or covers.

Before `up` or `down`, the launcher verifies the Docker resource labels and
container Compose paths for this state directory. It refuses a project with
foreign containers, networks or volumes, including when `owner.json` or a receipt
names that project. Use a new project and state directory after a collision.
Older showcases lack the state labels: `check` still works, but `up` and `down`
require manual inspection and cleanup of that older stack before reusing its
project. A saved project name alone is intentionally insufficient to adopt it.

For a second disposable instance, select a different state directory and port:

```sh
export ZERO_SHOWCASE_STATE_DIR=/tmp/zero-showcase-scratch
ZERO_SHOWCASE_PORT=18860 node examples/showcase/run.mjs
node examples/showcase/run.mjs check
node examples/showcase/run.mjs down
unset ZERO_SHOWCASE_STATE_DIR
```

The override applies to all three commands and resolves relative paths from the
repository root. Each state directory gets a distinct default Compose project;
you may also choose one with `ZERO_SHOWCASE_PROJECT`. Keep state outside Git or
under the ignored `.zero/` directory: it contains disposable application
passwords. The printed check/stop commands include the selected state directory.
Only that instance's resources are removed; build output and verified plugin
downloads remain available for the next start.

This demo uses local disk media. S3 is covered separately by the existing real
Garage lane:

```sh
ZERO_WP_PROJECT=zero-showcase-s3 ZERO_WP_PORT=8862 ZERO_WP_REPLICA_PORT=8863 tests/wp/run.sh --s3
```

For compiler examples and formatted TypeScript/PHP comparisons, the existing
website tour and browser compiler are in [`site/`](../../site/README.md).
