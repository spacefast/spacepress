# Try First

From the repository root:

```sh
node examples/showcase/run.mjs
```

This builds the current compiler, boots WordPress + MariaDB, seeds a pantry,
uploads an original cover image, and retains the two stories and three linked
tasks from the classic demo. It runs a short HTTP check before printing the URLs.
Open the printed showcase URL for the pantry tracker and original publication
tour on the same page. The source tabs show the actual TypeScript and compiled
PHP. The **Config lab** shows every config source file, including the pantry and
story definitions. Edit a file and select **Compile preview** to run the real
First compiler in a browser worker. Syntax highlighting and split/unified diffs
use the same locally bundled `@pierre/diffs` viewer as the website. Source changes
are compared with source; generated PHP changes are compared with generated PHP.
The output selector also exposes the schema, typed client and SQL migrations.

Drafts stay in this browser, with diagnostics and the last successful output
retained on errors. Copy or download a file, or download all sources as JSON.
**Compile preview** does not apply migrations, execute PHP or change WordPress.
It uses the running build's schema snapshot to preview incremental migrations.

Sign in as **admin** and select **Apply to demo** to compile those same edited
files on the host and rebuild the running WordPress app. Added tables and new
nullable fields (or required fields with defaults) are supported. Removing or
changing an existing field or its storage is refused; use preview to inspect
those changes. Actions and hooks can be rebuilt too. Apply briefly puts the demo
in maintenance mode, then reloads the generated plugin and runs its migrations.
Select **Reload updated demo** after success to load the accepted sources and client.
Existing records are retained. Browser-applied sources and migration history
live in the selected private state directory and survive launcher reruns;
download sources to keep or commit them. The explicit `check` command still
verifies the original demo contract: deliberately changing its actions or hooks
can make that check fail. Rebuild controls remain available to correct the app.

An invalid compile or refused migration leaves the running app unchanged.
If a request loses its response, **Check build status** recovers that exact job;
**Retry same submission** uses its saved ID and files. It never starts a second
build automatically. Stale pages must reload before applying, and only one build
runs at a time. Editors can preview code, but only administrators can Apply.

The rebuild service listens on a private Unix socket mounted into WordPress;
there is no extra network port. It starts with the launcher and stops with
`down`. Build requests, logs and prior artifacts are retained under
`.first/showcase/builds/`. If publication or a migration is interrupted, further
rebuilds stop for inspection rather than replaying uncertain database changes.
The previous plugin is restored where possible, but database changes are never
reversed automatically. Inspect that job's `job.json`, candidate migrations and
WordPress migration ledger before making an explicit recovery decision. Do not
remove its recovery flag just to retry. The normal runtime migration recovery
commands remain documented in the WordPress harness. The launcher also refuses
to overwrite this evidence or stop a stack with an unresolved publication.

Edit records in `/first-admin/` or the classic WordPress admin’s **Pantry** menu,
then refresh. The classic menu provides items, locations and the shopping list
using the same generated client and server rules.

The pantry tracks quantities, low-stock thresholds, expiry dates and storage
locations. Consuming stock never takes it below zero. Reaching the low-stock
threshold adds one shopping entry per item. Buying enough stock completes that
entry; a later low-stock crossing reopens the same entry. A partial purchase
keeps it on the list. Editors can add items and locations in the native admin;
the public page uses the current WordPress login for stock actions. Readers
can browse without signing in. These actions and table writes require editor
access on the server. Shopping updates run in the request; this demo has no
background notification job. The launcher also installs the showcase companion plugin that places pantry CRUD screens inside classic WordPress; it uses the generated client and the same REST permissions and hooks, with no separate copy of the data.

Items also have a brand, multiline storage notes and opened-pack status. Link
an item to a native WordPress cooking story to combine SQL stock with a block
editor body, SCF groups/repeaters/layouts/JSON and a story cover. The seeded
**A pantry supper** links tomato passata and dried pasta; expand **Details &
cooking notes** on either item, then follow the story. A separate details seed
marker adds these examples once to existing demos without rewriting existing
stock or story records. Subsequent starts preserve their edits and deletions.

At the default address, open [the pantry](http://127.0.0.1:8860/wp-content/plugins/first-app-showcase/public/#pantry)
or [the classic stories](http://127.0.0.1:8860/wp-content/plugins/first-app-showcase/public/#notebook).
Use the printed origin instead when running on a different port or through
Tailscale.

The default showcase login is **admin** / **first-test-admin**, with the full
WordPress sidebar, plugin installation, SCF, Themes, Users, Tools and Settings.
The public page links directly to those screens. Use **editor** /
**first-test-editor** when testing content-only permissions. The public page has
a sign-in link to switch accounts. Extra plugins installed through WordPress
survive launcher rebuilds; rebuilding refreshes First's generated plugins and
pinned dependencies. `down` still removes this disposable site's database and
uploads. Open `/wp-admin/plugins.php` for plugins and
`/wp-admin/edit.php?post_type=acf-field-group` for SCF. First's generated SCF fields
are code-owned and appear on the native story editor; create separate field
groups in SCF. These are intentionally tracked disposable local credentials
with no customer or production access. Application passwords stay in the ignored
`.first/showcase/receipt.json`; the public page contains none.

The prerequisites are the repository's normal Rust, PHP (including GD), Node
22.18+ with npm, Docker Compose, Bash 4+, Python, curl, sha256sum and rsync toolchain;
see [Contributing](../../CONTRIBUTING.md#toolchain). The Rust
`wasm32-unknown-unknown` target is needed for the browser compiler, as for the
website. The launcher builds the current WASM compiler and installs the pinned
code-viewer dependencies automatically with `npm ci` in `code-tools/`. All viewer
code, grammars, themes and compiler bytes are served locally; the browser does
not fetch a CDN. Dependency licenses are linked from the lab.
The launcher checks prerequisites before building or starting containers and
reports unavailable commands, missing PHP GD, and Docker connection failures.
It also rejects an occupied host port before starting a new stack.
The demo binds only to `127.0.0.1:8860`. When using a remote machine, forward
that port in your editor or with SSH.

To open it from another computer on your Tailscale network, expose the existing
loopback server with Tailscale Serve:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8860
FIRST_SHOWCASE_URL=https://your-machine.your-tailnet.ts.net:8443 node examples/showcase/run.mjs
```

Use the HTTPS address printed by Tailscale as `FIRST_SHOWCASE_URL`. The launcher
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

`check` verifies the pantry's public relations, nonnegative stock, positive action
amounts, anonymous write denial, consume/restock actions, one shopping entry per
item, completion and reopening, and relation cleanup. It creates its own temporary
item and location and removes them and their shopping entries, including on
failure. It also verifies public reads, collection/table relations, editor-only field
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
`.first/showcase/`; existing example snapshots, test fixtures and other Docker
stacks are untouched. Starting after `down` seeds a new database. The database
uses the test harness's tmpfs: restarting its database container loses the data.
The default Compose name is unique to its state directory. Use
`FIRST_SHOWCASE_PROJECT` and `FIRST_SHOWCASE_PORT` on the first start to choose a
different name and port; they are saved for subsequent commands in that state
directory. `down` removes
the saved ownership and application-password receipt only after Compose cleanup
succeeds. Supply custom project/port settings again when starting after `down`.
A failed first start can also be cleaned up with `down`, even if the copied
harness script is missing. Failed cleanup retains ownership so you can retry;
it never reports a stopped stack after a failed Docker command. If seeding
was interrupted partway through, `down` followed by `up` starts a clean demo.
After a successful initial seed, a database marker prevents subsequent starts
from recreating deliberately deleted stories, tasks or covers. The pantry has its
own seed marker: upgrading an existing demo adds pantry data once without
changing the publication demo. Later starts preserve edited or deleted pantry
items, locations and shopping entries too.

Before `up` or `down`, the launcher verifies the Docker resource labels and
container Compose paths for this state directory. It refuses a project with
foreign containers, networks or volumes, including when `owner.json` or a receipt
names that project. Use a new project and state directory after a collision.
Older showcases lack the state labels: `check` still works, but `up` and `down`
require manual inspection and cleanup of that older stack before reusing its
project. A saved project name alone is intentionally insufficient to adopt it.

For a second disposable instance, select a different state directory and port:

```sh
export FIRST_SHOWCASE_STATE_DIR=/tmp/first-showcase-scratch
FIRST_SHOWCASE_PORT=18860 node examples/showcase/run.mjs
node examples/showcase/run.mjs check
node examples/showcase/run.mjs down
unset FIRST_SHOWCASE_STATE_DIR
```

The override applies to all three commands and resolves relative paths from the
repository root. Each state directory gets a distinct default Compose project;
you may also choose one with `FIRST_SHOWCASE_PROJECT`. Keep state outside Git or
under the ignored `.first/` directory: it contains disposable application
passwords. The printed check/stop commands include the selected state directory.
Only that instance's resources are removed; build output and verified plugin
downloads remain available for the next start.

This demo uses local disk media. S3 is covered separately by the existing real
Garage lane:

```sh
FIRST_WP_PROJECT=first-showcase-s3 FIRST_WP_PORT=8862 FIRST_WP_REPLICA_PORT=8863 tests/wp/run.sh --s3
```

The additive Apply policy and interrupted-job recovery have fast checks:

```sh
node --test examples/showcase/build-app.test.mjs examples/showcase/rebuild-service.test.mjs
```

For compiler examples and formatted TypeScript/PHP comparisons, the docs site's
tour and browser compiler are in [`docs-site/`](../../docs-site/README.md).
