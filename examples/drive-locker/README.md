# Drive Locker

A personal inventory for SSDs, HDDs, NVMe drives, SD cards and USB drives.
Find a drive by its serial, label, model or recorded contents, then see its place,
health history, warranty and capacity. The React SPA has search, places, drive
detail, add-drive and capacity screens, with bottom navigation for use at a rack.

`node examples/drive-locker/verify.mjs` checks drive, place and contents CRUD
over HTTP, all five actions, two-owner isolation and the replacement job. Drive
creation works over HTTP. Owner deletes of drives and places don't yet: see the
note at the end. No live Space was created because the installed publishing CLI
could not resolve the requested team. This example is not verified live.

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

Serials are trimmed and uppercased. A compound unique index,
`.index(["ownerId", "serial"], { unique: true })`, refuses a second drive with the
same serial for one owner (409 `unique_violation`), while separate owners can
record the same serial without sharing inventory.

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

`TP_TEST_URL` names the local site (default `http://localhost:8796`). The
verifier creates, edits and deletes drives, places and contents over HTTP as two
owners, calls every action, runs Action Scheduler and reads the resulting stamp,
then deletes its rows as their owner. Passwords stay in process memory and are
revoked after the run.

The checked-in [HTTP transcript](verification/local-http.txt) is an older run's
request methods, paths, statuses and JSON responses, from before drive creation
worked over HTTP. The capacity fixture is
`1000 - 240 = 760 GB` for its own place, with all other owner's rows excluded.
The [verification record](verification/README.md) separates local, browser and
publication evidence.

## Publish to Spacefast

Hosted deployment of a `typedpress.config.ts` project is not available in a
released `spacefast` CLI yet; see the [Spacefast deploy guide](../../docs/spacefast-deploy.md). Stage only the intended source and
public assets, excluding local WordPress data, credentials, dependencies and
caches:

```sh
npm --prefix examples/drive-locker/web ci
npm --prefix examples/drive-locker/web run build
node examples/drive-locker/prepare-publish.mjs
```

After publishing, register the live frontend callback with typedpress-identity,
then verify sign-in, a collection read and an action on that hostname.

## Notes

**Open gap ([#533](https://github.com/spacefast/zero/issues/533)):** on main, deleting a row that another table can reference returns `409 reference_violation` (`Rows in X may reference this row`) over HTTP, even when nothing references it, because the owner filter can't read the whole referencing table. Here that is deleting a drive (contents and health readings reference it) or a place (drives reference it). The verifier passes on the branch that fixes this; on main it stops at that delete, and CI marks it expected-fail with the issue number.

Resolved build diagnostics are preserved [separately](verification/diagnostics.md).
