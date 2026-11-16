# Stuff drawer

A personal inventory for cables, adapters, chargers, tools, books, and other small things, with a lending log. There is no custom frontend. WordPress owns the UI and sign-in.

## Data and screens

| Resource | Storage and UI | Fields |
| --- | --- | --- |
| Bins | WordPress collection, wp-admin and TypedPress Admin | name, location, photo, ownerId |
| Things | WordPress collection, wp-admin and TypedPress Admin | name, kind, connectorA, connectorB, lengthCm, wattage, binId, quantity, photo, tags JSON, ownerId |
| People | WordPress collection, wp-admin and TypedPress Admin | name, contact, ownerId |
| Loans | SQL table, TypedPress Admin lending log | thingId, personId, lentOn, dueOn, returnedOn, overdueAt, ownerId |

Every build includes [TypedPress Admin](../../docs/admin.md) at `/wp-admin/new/`. Classic WordPress lists and edit screens use Secure Custom Fields. The loan table uses TypedPress Admin's table forms and relation pickers. Photo fields use WordPress media.

Each row belongs to the signed-in WordPress user. Read, update, and delete rules return an owner filter. `beforeCreate` stamps `ownerId` from that user; clients cannot supply or change it. Actions explicitly scope trusted database calls and validate that references belong to the same owner.

WordPress media URLs follow the site's media policy. Owning an inventory row does not make its photo bytes private on an otherwise public WordPress installation. The example Space restricts its whole site to the owning team.

## Run locally

From the repository root, build the compiler from main and then the example:

```sh
cargo build --locked
./target/debug/typedpress check examples/stuff-drawer --json
./target/debug/typedpress build examples/stuff-drawer
./target/debug/typedpress dev examples/stuff-drawer --no-watch --port 8897
```

`typedpress build` produces `tp/_generated/db.d.ts`, `tp/_generated/client/`, `tp/_generated/migrations/`, and the pinned WordPress plugin lock.

The required plugins are Secure Custom Fields 6.9.7, Action Scheduler 4.2.0, and MCP Adapter 0.7.1. TypedPress builds and installs their pinned packages. This app does not use locales or a second identity system.

After a successful start, sign into `/wp-admin/` with Studio's disposable `admin` / `typedpress-test-admin` account. Visit `/wp-admin/new/` with the same account. Use the URL printed by Studio if the existing site has another port.

Create an application password with WP-CLI. Capture it in your secret manager or environment, rather than committing it:

```sh
./target/debug/typedpress wp --site examples/stuff-drawer user application-password create admin stuff-drawer --porcelain
```

Set `TP_SITE` to Studio's URL and `TP_APP_PASSWORD` to `admin:<application-password>`, then run:

```sh
node examples/stuff-drawer/verify.mjs
./target/debug/typedpress wp --site examples/stuff-drawer action-scheduler run
node examples/stuff-drawer/verify.mjs --stamps
```

Before the last command, set `TP_STAMP_LOAN_ID` to the ID printed by the first run. Set `TP_OTHER_APP_PASSWORD` for a second WordPress user to exercise isolation as well. The script leaves labeled demo rows for inspection and screenshots. It prints HTTP statuses and response bodies without credentials.

On 2026-11-16 the first command, with `TP_SITE`, `TP_APP_PASSWORD`, and `TP_OTHER_APP_PASSWORD` set, passed against a local Studio site running the fix for [#533](https://github.com/spacefast/zero/issues/533), and printed:

```text
PASS: a second WordPress user cannot read or lend another owner's rows.
PASS: collection CRUD, owner protection, all five actions, search, quantity exhaustion, lending replay, return replay, and overdue dates.
```

That run includes deleting an empty bin (200) and a `PATCH /things/<id>` with `{"tags":{"travel":true}}`, which answers `422 invalid_input` from the `json()` field validator. Earlier builds answered that request with a 500. The `--stamps` check of the Action Scheduler stamp was not run that day.

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
https://your-site.example/wp-json/mcp/typedpress-stuff-drawer
```

Authenticate with HTTP Basic auth using your WordPress username and an application password from **Users → Profile → Application passwords**. Supply credentials through your agent's secret configuration. Spacefast team access is a separate gate; it does not replace WordPress application-password authentication.

The endpoint and names below follow the actual registration in [`runtime/TypedPress/Wp/Abilities/Register.php`](../../runtime/TypedPress/Wp/Abilities/Register.php). Collections and actions default to agent exposure. No deployed generated plugin has been inspected and MCP calls were not part of the local run, so these abilities are not claimed to exist on the current Space.

| Ask your agent | Ability calls |
| --- | --- |
| "Do I have a USB-C to Lightning cable, and where?" | `stuff-drawer/find` with `query: "USB-C Lightning"`; reports the bin location and available copies. |
| "Lend that cable to Sam until Friday." | `stuff-drawer/people-list` to resolve Sam, `stuff-drawer/find` to resolve the cable, then `stuff-drawer/lend` with the returned IDs and an explicit `YYYY-MM-DD` due date. |
| "What is overdue, what else does Sam have, and mark the cable he returned today as back." | `stuff-drawer/overdue`, `stuff-drawer/people-list`, `stuff-drawer/who-has`, then `stuff-drawer/give-back` using the returned loan ID. |

The other collection abilities use the same runtime contract, such as `stuff-drawer/bins-create`, `stuff-drawer/things-list`, and `stuff-drawer/loans-update`. `giveBack` becomes `give-back`; `whoHas` becomes `who-has`.

## Screenshots

| Requested screenshot | Status |
| --- | --- |
| wp-admin Things list | Not captured. |
| wp-admin Thing edit screen with SCF | Not captured. Native owner stamping also has the limitation below. |
| TypedPress Admin inventory and lending log | Not captured. |

These screenshots are not done. Run the HTTP verifier to create demo data, then capture the real list, SCF editor, and `/wp-admin/new/` screens. No mock screens or unrelated screenshots are included.

## Customize it

| Change | Edit |
| --- | --- |
| Track batteries, lenses, or board games | Extend the `kind` enum in `typedpress.config.ts`. |
| Describe your storage | Change the bin location help text; create bins for drawers, shelves, and boxes. |
| Find things by a nickname | Add strings to a thing's JSON `tags`, such as `["iphone", "travel"]`. |
| Record serial numbers or condition | Add a field to Things. Run `typedpress build`, inspect the migration, and commit the generated files. |
| Change overdue behavior | Edit `scheduleOverdue` and the `markOverdue` job. Keep using Action Scheduler. |
| Change an editor label | Use the field's `.ui({ label, help, placeholder })` metadata. |

## Known gaps

`typedpress check examples/stuff-drawer` passes. Earlier versions of this README recorded compile errors here; the source now reads them out: `AccessCtx` and `HookCtx` compile, the loan checks build their argument field by field instead of spreading a partial patch, `quantity` is read once before it is compared, and the search loop skips an absent word.

**Open gap ([#533](https://github.com/spacefast/zero/issues/533)):** on main, deleting a row that another table can reference returns `409 reference_violation` (`Rows in X may reference this row`) over HTTP, even when nothing references it, because the owner filter can't read the whole referencing table. Here that is deleting a bin, even an empty one (things reference bins). The verifier passes on the branch that fixes this; on main it stops at that delete, and CI marks it expected-fail with the issue number.

### Native editor saves skip before hooks

[`types/typedpress/index.d.ts`](../../types/typedpress/index.d.ts) documents the current contract verbatim:

> On WordPress editor saves only the `after*` hooks run.

The owner assignments in `typedpress.config.ts:111`, `:112`, and `:115` therefore do not run when a bin, person, or thing is created through wp-admin, SCF, or core REST. Those paths cannot currently establish the required ownership using this design. The bin ownership and quantity checks in `beforeUpdate` are also skipped by native editor saves. These are source-confirmed limitations, not successful live tests. Loans use table forms and the normal write pipeline.

### Lending capacity is not serialized

The app checks the number of active loans before inserting or editing a loan. Main exposes no row-lock operation through this database API. Concurrent requests on MySQL or MariaDB can both observe a remaining copy. The app does not claim atomic inventory reservation; concurrent lending has not been verified. An ordinary transaction alone does not make this check a reservation.

### TypeScript checks report a circular loan type

With the generated `tp/_generated/db.d.ts` present, `tsc -p examples/stuff-drawer` (TypeScript 5.9.3) reports 5 errors on 2026-11-16, counted as lines matching `error TS`. `type Loan = InferSelectModel<typeof loans>` is used inside the `loans` table's own hooks, so TypeScript reports `'loans' implicitly has type 'any'` (line 50), `Type alias 'Loan' circularly references itself` (line 81), and `'loan' is referenced directly or indirectly in its own type annotation` (line 108). With `loans` typed as `any`, the `{ id }` filters at lines 133 and 173 fail as `TS2353`. `typedpress check` is unaffected.

## Spacefast

Hosted deployment of a `typedpress.config.ts` project is not available in a
released `spacefast` CLI yet; see the [Spacefast deploy guide](../../docs/spacefast-deploy.md). After publishing, verify a collection
read, an action and WordPress sign-in on the live origin.
