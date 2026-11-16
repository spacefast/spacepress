# Drive Locker

A personal inventory for SSDs, HDDs, NVMe drives, SD cards and USB drives.
Find a drive by its serial, label, model or recorded contents, then see its place,
health history, warranty and capacity. The React SPA has search, places, drive
detail, add-drive and capacity screens, with bottom navigation for use at a rack.

The source compiles on `main` at `ef0a42e3883eb146ad6318ff32cbc54cdb2e31d1`.
Drive creation, editing and deletion have runtime restrictions described below.
No live Space was created because the installed publishing CLI could not resolve
the requested team. This example is not verified live.

## Run locally

From the repository root, build the compiler and app, then build the frontend:

```sh
cargo build --release
./target/release/typedpress build examples/drive-locker
npm --prefix examples/drive-locker/web ci
npm --prefix examples/drive-locker/web run build
./target/release/typedpress dev examples/drive-locker --port 8796 --no-watch
./target/release/typedpress identity app add --site examples/drive-locker \
	--name='Drive Locker' --id=app_drive_locker \
	--redirect=http://127.0.0.1:5196/ --origin=http://127.0.0.1:5196
npm --prefix examples/drive-locker/web run dev
```

Open `http://127.0.0.1:5196/`. Sign in with the disposable Studio account
`admin` / `typedpress-test-admin`, choose password sign-in, and approve the application.
Do not use these credentials outside local development. Sessions stay in
session storage, and the callback removes the authorization code from the URL.

For the watched development loop, run these commands in separate terminals:

```sh
./target/release/typedpress dev examples/drive-locker --port 8796
npm --prefix examples/drive-locker/web run dev
```

Vite proxies `/wp-json`, `/identity` and `/.well-known` to
`http://localhost:8796`. Set `TP_DEV_URL` when Studio uses another port.
Register the exact Vite URL and origin if you change its address. Studio keeps an
existing site's original port. To stop this example's backend:

```sh
./target/release/typedpress dev stop examples/drive-locker
```

Vite builds into `public/` with relative asset paths. `public/` is ignored because
the [deploy guide](../../docs/spacefast-deploy.md) publishes built static files
as they are and does not require committing this SPA's bundle. Build it before
publishing. `typedpress dev` rebuilds the plugin and copies the current bundle into
`/wp-content/plugins/typedpress-app-drive-locker/public/`; the sign-in registration above
is for the Vite URL. A separately served bundle needs its own registered callback.

## Data and actions

All inventory rows use an owner read, update and delete filter. `beforeCreate`
sets `ownerId` from the signed-in WordPress user. Clients cannot set or change
it. Related places and drives must have the same owner, including on updates.
The member projection uses existing WordPress accounts and typedpress-identity.

Serials are trimmed and uppercased. A protected, unique `serialKey` stores
`ownerId + ':' + serial`, so separate owners can record the same serial without
sharing inventory. Its maximum length fits a MySQL unique text index. Action
responses explicitly omit this internal key.

| Action | Input | Result |
| --- | --- | --- |
| `logHealth` | `driveId`, `readOn`, `powerOnHours`, `wearPercent`, `reallocatedSectors`, `tempC` | Saved reading and `ok`, `watch` or `replace` |
| `whereIs` | `query` | Case-insensitive literal matches in serial, label, model or contents, with their drive and place |
| `capacityReport` | `{}` | Total, used and free GB overall, by place, and by drive kind |
| `warrantyExpiring` | `days`, default 30, between 0 and 3650 | Non-retired drives whose warranty ends between today and the cutoff, inclusive |
| `retire` | `driveId` | Drive with status `retired`; history and contents remain |

For `logHealth`, wear means percentage of rated life **used**. Readings must use
a date after the latest reading, so this example accepts one reading per drive
per calendar day. Lifetime hours, wear and reallocated-sector counters cannot
decrease. Temperature can decrease.

`wearRise = new wearPercent - previous wearPercent` and
`sectorRise = new reallocatedSectors - previous reallocatedSectors`.
Without a previous reading, both rises are zero. The example's thresholds are:

| Verdict | Any matching condition |
| --- | --- |
| `replace` | Wear ≥ 90%, sectors ≥ 100, temperature ≥ 70°C, wear rise ≥ 10 percentage points, or sector rise ≥ 10 |
| `watch` | Wear ≥ 70%, any reallocated sector, temperature ≥ 55°C, wear rise ≥ 3 percentage points, or positive sector rise |
| `ok` | Neither of the preceding rows matches |

`replace` takes precedence. These are illustrative thresholds, not a vendor's
failure prediction. Every `replace` verdict queues the single `stampReplacement`
Action Scheduler job. Its key groups waiting jobs by owner and drive, and the
handler stamps `replacementNeededAt` only when it is null. Retries preserve the
first stamp. It does not retire the drive automatically.

Capacity uses decimal GB. For the signed-in owner, across **all statuses**:
`totalGb = sum(drives.capacityGb)`, `usedGb = sum(contents.usedGb)` for those
drives, and `freeGb = totalGb - usedGb`. Place rows group by `placeId`, including
an Unassigned group. Kind rows group by `kind`. Empty places and kinds have zero
totals. Content writes reject a sum above their drive's capacity, and capacity
edits reject values below recorded usage.

The SPA uses the generated client in `tp/_generated/client/`. React, React DOM and Vite
have exact versions in `web/package.json` and `web/package-lock.json`. The layout
uses safe-area insets, labelled forms, a skip link, visible keyboard focus, light
and dark themes, and controls at least 44 CSS pixels in both dimensions.

## Use it from your agent

The required MCP Adapter serves this app at:

```text
https://YOUR-SITE/wp-json/mcp/typedpress-drive-locker
```

Authenticate with HTTP Basic using your WordPress username and an application
password created in your WordPress profile. Use your own account so the same
owner rules apply. Do not put that password in a prompt or source file. To
create a disposable application password on the local Studio site:

```sh
./target/release/typedpress wp --site examples/drive-locker \
	user application-password create admin drive-locker-agent --porcelain
```

On a team-restricted Space, the connection must also satisfy Spacefast access.
Do not make inventory public to enable an agent.

| Prompt | Ability and example input |
| --- | --- |
| "Where is the drive containing the family photos?" | `drive-locker/where-is`, `{"query":"family photos"}` |
| "Log the reading for drive 7 on November 9: 12,000 hours, 75% wear, 4 reallocated sectors and 42°C." | `drive-locker/log-health`, `{"driveId":7,"readOn":"2026-11-09","powerOnHours":12000,"wearPercent":75,"reallocatedSectors":4,"tempC":42}` |
| "How much capacity is free at each place and for each drive kind?" | `drive-locker/capacity-report`, `{}` |

Every table's CRUD operations and all five actions are abilities. For example,
`drive-locker/drives-list` lists accessible drives and
`drive-locker/drives-create` uses the same guarded creation path as REST.
The endpoint and names come from
[`Register.php`](../../runtime/TypedPress/Wp/Abilities/Register.php), the emitted
`schema.php`, and the local `typedpress abilities --site examples/drive-locker` output. The real MCP initialize
request is in [the local transcript](verification/local-http.txt).

## Verify

From the repository root:

```sh
./target/release/typedpress check examples/drive-locker --json
./target/release/typedpress build examples/drive-locker --frozen
tsc -p examples/drive-locker
npm --prefix examples/drive-locker/web run build
node examples/drive-locker/verify.mjs
```

The ordinary HTTP verifier fails at the blocked drive create. To exercise the
remaining paths on the current main, use the explicit probe mode:

```sh
node examples/drive-locker/verify.mjs --probe-main
```

That mode records the failed HTTP create and uses a trusted local WP-CLI insert
for its disposable drive fixture. It then calls every action through real HTTP,
checks owner isolation, exercises contents CRUD, runs Action Scheduler and reads
the resulting stamp. Parent-row cleanup also uses trusted CLI after recording
the HTTP delete refusal. Passwords stay in process memory and are revoked after
the run. This mode proves the listed paths; it does not prove HTTP drive CRUD.

The checked-in [HTTP transcript](verification/local-http.txt) contains commands'
request methods, paths, statuses and JSON responses. The capacity fixture is
`1000 - 240 = 760 GB` for its own place, with all other owner's rows excluded.
The [verification record](verification/README.md) separates local, browser and
publication evidence.

## Publish to Spacefast

Use the documented preflight and publish commands once the installed CLI supports
them. Prepare only the intended source and public assets, excluding local
WordPress data, credentials, dependencies and caches:

```sh
sf typedpress check examples/drive-locker
npm --prefix examples/drive-locker/web ci
npm --prefix examples/drive-locker/web run build
node examples/drive-locker/prepare-publish.mjs
sf publish examples/drive-locker/.tp/publish --team spacefast-examples \
	--name 'Drive Locker' --slug drive-locker --access team --json --wait
```

The staging script preserves the CLI's `.spacefast/` selection for later
updates. Reuse that Space instead of creating another. Verify the receipt's
team, live revision and team-only access. Register the live frontend callback
with typedpress-identity, then verify sign-in, a collection read and an action on
that hostname. No live URL exists for this attempt.

## Known gaps on main (ef0a42e3883eb146ad6318ff32cbc54cdb2e31d1)

The final source has no compiler diagnostics. The compiler diagnostic count is
`diagnostics.filter(d => d.severity === 'error').length = 0` in
[`check.json`](verification/check.json).

| Gap | Exact observed diagnostic | Trigger in this example |
| --- | --- | --- |
| Owner-filtered unique writes | HTTP 403, `forbidden`, `You can't set serialKey`, pointer `/serialKey` | `serialKey.unique()` with the owner-filtered `access` in `typedpress.config.ts`; `POST /__tp/api/v1/drives` |
| Owner-filtered referential deletes | HTTP 409, `reference_violation`, `Rows in health_readings may reference this row` | Drive references from `healthReadings.driveId` and deleting a drive |
| Owner-filtered referential deletes | HTTP 409, `reference_violation`, `Rows in drives may reference this row` | `drives.placeId` and deleting an empty place |
| Missing CLI preflight | `Command zero:check not found.` | `sf typedpress check --help` using installed `spacefast/0.8.0` |
| Publishing team resolution | `validation_error`, `Could not find team "team_3f222eb89f634980a2552a38fbdc70ba".` | `sf publish ... --team <resolved team ID> --access team` |

The constraint refusals follow main's
[write pipeline contract](../../docs/runtime-contract.md#write-pipeline-dbinsertupdatedelete-rest-and-cli-all-go-through-it).
The app preserves its owner filters, database uniqueness and references. It
does not make reads public or replace constraints with a race-prone lookup.

The CLI's typedpress-page team lookup omits the target team even though a direct
authenticated team read confirms access. Publication stopped before Space
creation. Its dry run also classifies this raw-source input as static with
`runtime: null`; host compilation remains unproven. No compiler, runtime or
shared CLI changes are included here. Resolved build diagnostics and the failed
initial publication plan are preserved [separately](verification/diagnostics.md).
