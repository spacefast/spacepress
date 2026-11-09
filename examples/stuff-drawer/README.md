# Stuff drawer

A personal inventory for cables, adapters, chargers, tools, books, and other small things, with a lending log. There is no custom frontend. WordPress owns the UI and sign-in.

This example currently **does not compile on main**. See [Known gaps](#known-gaps-on-main-b66e98b3). The published Space is a restricted source snapshot, not a working inventory app. Local HTTP verification, generated artifacts, and admin screenshots remain blocked by the compiler error.

## Data and screens

| Resource | Storage and UI | Fields |
| --- | --- | --- |
| Bins | WordPress collection, wp-admin and Zero Admin | name, location, photo, ownerId |
| Things | WordPress collection, wp-admin and Zero Admin | name, kind, connectorA, connectorB, lengthCm, wattage, binId, quantity, photo, tags JSON, ownerId |
| People | WordPress collection, wp-admin and Zero Admin | name, contact, ownerId |
| Loans | SQL table, Zero Admin lending log | thingId, personId, lentOn, dueOn, returnedOn, overdueAt, ownerId |

`admin: true` packages [Zero Admin](../../docs/admin.md) at `/zero-admin/`. Classic WordPress lists and edit screens use Secure Custom Fields. The loan table uses Zero Admin's table forms and relation pickers. Photo fields use WordPress media.

Each row belongs to the signed-in WordPress user. Read, update, and delete rules return an owner filter. `beforeCreate` stamps `ownerId` from that user; clients cannot supply or change it. Actions explicitly scope trusted database calls and validate that references belong to the same owner.

WordPress media URLs follow the site's media policy. Owning an inventory row does not make its photo bytes private on an otherwise public WordPress installation. The example Space restricts its whole site to the owning team.

## Run locally

From the repository root, build the compiler from main and then the example:

```sh
cargo build --locked
./target/debug/zero check examples/stuff-drawer --json
./target/debug/zero build examples/stuff-drawer
./target/debug/zero dev examples/stuff-drawer --no-watch --port 8897
```

These commands currently stop at the diagnostic below. Once main supports this source, `zero build` produces `zero/_generated/db.d.ts`, `zero/_generated/client/`, `zero/_generated/migrations/`, and the pinned WordPress plugin lock. They are not fabricated or copied from another app here.

The required plugins are Secure Custom Fields 6.9.7, Action Scheduler 4.2.0, and MCP Adapter 0.7.1. Zero builds and installs their pinned packages. This app does not use locales or a second identity system.

After a successful start, sign into `/wp-admin/` with Studio's disposable `admin` / `zero-test-admin` account. Visit `/zero-admin/` with the same account. Use the URL printed by Studio if the existing site has another port.

Create an application password with WP-CLI. Capture it in your secret manager or environment, rather than committing it:

```sh
./target/debug/zero wp --site examples/stuff-drawer user application-password create admin stuff-drawer --porcelain
```

Set `ZERO_SITE` to Studio's URL and `ZERO_APP_PASSWORD` to `admin:<application-password>`, then run:

```sh
node examples/stuff-drawer/verify.mjs
./target/debug/zero wp --site examples/stuff-drawer action-scheduler run
node examples/stuff-drawer/verify.mjs --stamps
```

Before the last command, set `ZERO_STAMP_LOAN_ID` to the ID printed by the first run. Set `ZERO_OTHER_APP_PASSWORD` for a second WordPress user to exercise isolation as well. The script leaves labeled demo rows for inspection and screenshots. It prints HTTP statuses and response bodies without credentials.

## Actions and overdue stamps

| Action | Input | Result |
| --- | --- | --- |
| `find` | `query` | Matches every whitespace-separated query word against name, tags, and connectors, ignoring case. Returns each thing, its bin, whether any copy is lent, and the available quantity. |
| `lend` | `thingId`, `personId`, `dueOn`, optional `lentOn` | Creates a loan for one copy. Checks ownership, dates, and remaining quantity. Supports the `Idempotency-Key` header. |
| `giveBack` | `loanId`, optional `returnedOn` | Records the return. Repeating it preserves the first return date. |
| `overdue` | none | Open loans whose due date is before today, with the owned thing and person. |
| `whoHas` | `personId` | The person's current open loans, with the owned thing and person. |

Dates use UTC calendar days. `quantity` is the total owned, including lent copies. Available copies = `quantity - count(loans where thingId matches, ownerId matches, returnedOn is null)`.

The stock `job()` named `markOverdue` is queued after loan creation or update. Action Scheduler runs it after the end of `dueOn` in UTC. The job stamps `overdueAt` once and retains that timestamp as history after return. It checks the current owner, due date, and return state before writing, so an obsolete queued job cannot stamp a returned or extended loan. Jobs receive a trusted owner ID because their execution has no signed-in user. The job is not exposed as an agent ability.

`overdue` derives current lateness from dates even if Action Scheduler has not run yet. `overdueAt` records when the scheduler first observed lateness. No custom cron or worker loop is used.

## Use it from your agent

On an installed, compiled site, configure a Streamable HTTP MCP connection at:

```text
https://your-site.example/wp-json/mcp/zero-stuff-drawer
```

Authenticate with HTTP Basic auth using your WordPress username and an application password from **Users → Profile → Application passwords**. Supply credentials through your agent's secret configuration. Spacefast team access is a separate gate; it does not replace WordPress application-password authentication.

The endpoint and names below follow the actual registration in [`runtime/Zero/Wp/Abilities/Register.php`](../../runtime/Zero/Wp/Abilities/Register.php). Collections and actions default to agent exposure. A deployed generated plugin could not be inspected because compilation fails, so these abilities are not claimed to exist on the current Space.

| Ask your agent | Ability calls |
| --- | --- |
| "Do I have a USB-C to Lightning cable, and where?" | `stuff-drawer/find` with `query: "USB-C Lightning"`; reports the bin location and available copies. |
| "Lend that cable to Sam until Friday." | `stuff-drawer/people-list` to resolve Sam, `stuff-drawer/find` to resolve the cable, then `stuff-drawer/lend` with the returned IDs and an explicit `YYYY-MM-DD` due date. |
| "What is overdue, what else does Sam have, and mark the cable he returned today as back." | `stuff-drawer/overdue`, `stuff-drawer/people-list`, `stuff-drawer/who-has`, then `stuff-drawer/give-back` using the returned loan ID. |

The other collection abilities use the same runtime contract, such as `stuff-drawer/bins-create`, `stuff-drawer/things-list`, and `stuff-drawer/loans-update`. `giveBack` becomes `give-back`; `whoHas` becomes `who-has`.

## Screenshots

| Requested screenshot | Status |
| --- | --- |
| wp-admin Things list | Not captured. Local startup fails before installing the app. |
| wp-admin Thing edit screen with SCF | Not captured for the same reason. Native owner stamping also has the limitation below. |
| Zero Admin inventory and lending log | Not captured. There is no generated app or working local site to display. |

These screenshots are not done. Once main can build this source, run the HTTP verifier to create demo data, then capture the real list, SCF editor, and `/zero-admin/` screens. No mock screens or unrelated screenshots are included.

## Customize it

| Change | Edit |
| --- | --- |
| Track batteries, lenses, or board games | Extend the `kind` enum in `zero.config.ts`. |
| Describe your storage | Change the bin location help text; create bins for drawers, shelves, and boxes. |
| Find things by a nickname | Add strings to a thing's JSON `tags`, such as `["iphone", "travel"]`. |
| Record serial numbers or condition | Add a field to Things. Run `zero build`, inspect the migration, and commit the generated files when builds work. |
| Change overdue behavior | Edit `scheduleOverdue` and the `markOverdue` job. Keep using Action Scheduler. |
| Change an editor label | Use the field's `.ui({ label, help, placeholder })` metadata. |

## Known gaps on main b66e98b3

The native compiler was built from `b66e98b3866037061198c51ebef9534609a5e301`. No compiler or runtime files are changed by this example.

### Exported callback context types do not compile

`zero/lib/ownership.ts:5:34` uses the exported `AccessCtx` annotation:

```ts
export function ownerFilter(ctx: AccessCtx) {
```

`zero check --json` reports exactly one error diagnostic. Count = the number of entries in `diagnostics` with `severity === "error"`; compilation stops at this first error, so this is not a count of every possible unsupported construct.

`zero build examples/stuff-drawer` prints:

```text
error: unknown type `AccessCtx`
  --> zero/lib/ownership.ts:5:34
  |
5 | export function ownerFilter(ctx: AccessCtx) {
  |                                  ^^^^^^^^^
```

`zero dev examples/stuff-drawer --no-watch --port 8897` prints:

```text
error: unknown type `AccessCtx`
  --> zero/lib/ownership.ts:5:34
  |
5 | export function ownerFilter(ctx: AccessCtx) {
  |                                  ^^^^^^^^^
zero dev: Failed (1): build
```

Both `AccessCtx` and `HookCtx` are public exports and accepted type imports. Main's annotation resolver in `src/compile/annotations.rs` recognizes `FieldAccessCtx` and `JobCtx` but does not implement these two types. The source retains the ordinary exported types instead of changing the compiler or rewriting the app around this gap.

### Native editor saves skip before hooks

[`types/zero/index.d.ts`](../../types/zero/index.d.ts) documents the current contract verbatim:

> On WordPress editor saves only the `after*` hooks run.

The owner assignments in `zero.config.ts:111`, `:112`, and `:115` therefore do not run when a bin, person, or thing is created through wp-admin, SCF, or core REST. Those paths cannot currently establish the required ownership using this design. The bin ownership and quantity checks in `beforeUpdate` are also skipped by native editor saves. These are source-confirmed limitations, not successful live tests. Loans use table forms and the normal write pipeline.

### Lending capacity is not serialized

The app checks the number of active loans before inserting or editing a loan. Main exposes no row-lock operation through this database API. Concurrent requests on MySQL or MariaDB can both observe a remaining copy. The app does not claim atomic inventory reservation; concurrent lending has not been verified. An ordinary transaction alone does not make this check a reservation.

### TypeScript checks require the missing generated schema

`tsc -p examples/stuff-drawer` cannot type `db.query` without the `zero/_generated/db.d.ts` that the failed build would emit. Its current diagnostics are:

```text
examples/stuff-drawer/zero.config.ts(64,35): error TS2339: Property 'findFirst' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(72,39): error TS2339: Property 'findFirst' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(73,40): error TS2339: Property 'findFirst' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(79,41): error TS2339: Property 'findMany' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(82,39): error TS7006: Parameter 'entry' implicitly has an 'any' type.
examples/stuff-drawer/zero.config.ts(99,41): error TS2339: Property 'findFirst' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(100,42): error TS2339: Property 'findFirst' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(121,47): error TS2339: Property 'findMany' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(159,49): error TS2339: Property 'findMany' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(164,72): error TS2339: Property 'findFirst' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(165,47): error TS2339: Property 'findMany' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(183,43): error TS2339: Property 'findFirst' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(194,46): error TS2339: Property 'findMany' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(204,46): error TS2339: Property 'findFirst' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
examples/stuff-drawer/zero.config.ts(206,46): error TS2339: Property 'findMany' does not exist on type '"Schema not registered: add zero/_generated/db.d.ts (run `zero build`) so `db.query` knows your collections"'.
```

## Spacefast verification

Space URL: <https://stuff-drawer-inventory.space.fast/>. Access: owning team only. The automatically created link grant was revoked. The final grant check filters `status === "active"` and finds only the owning-team live and version grants.

`sf zero check` is required by the deployment guide, but the installed CLI refused it:

```text
Command zero:check not found.
Run with --help to see the supported usage.
```

A later invocation of `sf zero check examples/stuff-drawer` returned:

```text
Unknown command `sf zero check examples/stuff-drawer`. Did you mean `sf zero ls`? Run `sf help zero` for available commands.
```

The native check above was used to inspect main. Publication used only `sf publish`, including a remote-detection attempt:

```sh
sf publish examples/stuff-drawer --space spc_3e541c524ec04b1386bd9df3ac8a9e24 --remote --json --wait-timeout 120
```

The receipt reports version `ver_7074e2290eac46c3b68d90d2d93c9e81` ready, but the actual owning API reports `hasRuntime: false` and `runtimeCodeDetected: false`. Its recorded source revision is `06db7711eb50373c85c93e231f1140d3b7e398de`, before the documentation and source refinements in this PR, rather than current main `b66e98b3866037061198c51ebef9534609a5e301`. This is a source snapshot, not deployment of the inventory app. The host diagnostic is verbatim:

```text
No HTML files were found in the root of this version, so it serves in files mode with directory listing enabled.
```

Real anonymous HTTP requests returned:

```text
GET /wp-json/zero/v1/things -> HTTP 403, HTML title "This space is private"
POST /wp-json/zero/v1/actions/find {"query":"USB-C Lightning"} -> HTTP 403, HTML title "This space is private"
GET /wp-login.php -> HTTP 403, HTML title "This space is private"
```

The commands used `curl -sS --max-time 20`; the action request supplied `Content-Type: application/json` and the JSON body above. Authenticated Spacefast reads used:

```sh
sf fetch /wp-json/zero/v1/things --space spc_3e541c524ec04b1386bd9df3ac8a9e24 --status --headers --json
sf fetch /wp-login.php --space spc_3e541c524ec04b1386bd9df3ac8a9e24 --status --headers --json
```

Observed responses:

```text
/wp-json/zero/v1/things -> status 404, contentType "application/json; charset=UTF-8", runtime "1", versionId null
/wp-login.php -> status 200, contentType "text/html; charset=UTF-8", runtime "1", versionId null
```

Fetching the collection or action path with `sf fetch --output` returned:

```json
{"error":{"code":"private_fetch_failed","message":"Private fetch returned HTTP 404.","retryable":false}}
```

The native WordPress login page is reachable after Spacefast authentication. A completed WordPress sign-in, inventory collection read, action execution, and scheduler stamp have not been verified. Local startup never reached WordPress; `verify.mjs` passes `node --check` but has not passed a live run. The requested wp-admin, edit, and Zero Admin screenshots remain unavailable.
