# Subscriptions

A personal subscription tracker with a React SPA. Track renewal dates, payment
labels, categories, and charge history. Each row belongs to the signed-in
WordPress user.

## What it shows

| Piece | Behavior |
|---|---|
| `subscriptions`, `charges`, `categories` | Plain tables with owner filters on every read, update, and delete. Creation stamps `ownerId` from the authenticated user. Client writes cannot set ownership. |
| `monthlyBurn` | Active subscriptions only. Sum cents per currency and category: weekly × 52 ÷ 12, monthly unchanged, yearly ÷ 12. Round each resulting total after summing. Currencies stay separate. |
| `renewingSoon({ days })` | Active subscriptions owned by the caller, from today's UTC date through today + `days`, inclusive, ordered by renewal date. Overdue rows remain visible in the list. |
| `logCharge({ subscriptionId })` | Store the current amount on the scheduled renewal date, then advance by one cycle. Calendar months and years clamp to the last valid day. This records a charge; it does not charge a payment provider. Inactive subscriptions are rejected. |
| `cancel({ subscriptionId })` | Mark the subscription cancelled and return its cancellation URL. The user must still cancel with the vendor. |
| `remindRenewal` | One stock Action Scheduler job. Enqueue on active subscription writes, delayed until three days before renewal or immediately if already due. Stamp `remindedAt`. Stale jobs for another renewal date or an inactive subscription do nothing. No email or custom cron. |
| React SPA | Overview with monthly spending and category totals, upcoming renewals, a filtered list, an add/edit sheet, and detail with charge history. Uses typedpress-identity and the generated typed client. |

The charge action uses `once()` per subscription and observed renewal date to
serialize concurrent attempts, plus `idempotent: true` for request retries.
The frontend sends an `Idempotency-Key` for that renewal. Currency changes are
rejected once charges exist, so old amounts keep their original denomination.
Payment methods are labels, never card numbers or payment credentials.

## Run locally

Use a compiler built from this repository. `typedpress build` and `typedpress dev` manage the required
plugins and their activation.

```sh
cargo build --locked
./target/debug/typedpress build examples/subscriptions
npm --prefix examples/subscriptions/web ci
npm --prefix examples/subscriptions/web run build
./target/debug/typedpress build examples/subscriptions
./target/debug/typedpress dev examples/subscriptions --no-watch --port 8794
./target/debug/typedpress identity --site examples/subscriptions app add \
  --name=Subscriptions --id=app_subscriptions \
  --redirect=http://localhost:8794/wp-content/plugins/typedpress-app-subscriptions/public/index.html \
  --origin=http://localhost:8794
```

Open `http://localhost:8794/wp-content/plugins/typedpress-app-subscriptions/public/index.html`.
Use the URL and port Studio actually prints. The explicit `index.html` path
also works on Studio hosts that do not serve plugin directory indexes.
The sign-in button calls `auth.signIn()`; the callback calls `handleCallback()`.
The frontend stores no application password.

For the Vite loop, register its origin and callback, then start Vite:

```sh
./target/debug/typedpress identity --site examples/subscriptions app add \
  --name=Subscriptions --id=app_subscriptions_vite \
  --redirect=http://127.0.0.1:5173/ --origin=http://127.0.0.1:5173
VITE_ZERO_APP_ID=app_subscriptions_vite npm --prefix examples/subscriptions/web run dev
```

Keep `typedpress dev examples/subscriptions --port 8794` running in another terminal
without `--no-watch` to rebuild backend changes. Vite proxies `/wp-json` to
`http://localhost:8794`; set `TP_DEV_URL` if Studio uses another address. Vite
builds into `../public/` with relative asset URLs for plugin and Space publishing.
React, React DOM, Vite, and the TypeScript editor dependencies have exact pins
and an npm lockfile.

`public/` is ignored. The [deploy guide](../../docs/spacefast-deploy.md) says
static files are published as they are, and does not require committing Vite
output. Run `npm --prefix web ci && npm --prefix web run build` from this
example before publishing. `typedpress build` writes `tp/_generated/client/`,
`tp/_generated/migrations/`, `tp/_generated/db.d.ts`, and
`tp/_generated/wp-plugins.lock.json`; commit them with the config.

## Known gaps

`typedpress check examples/subscriptions` passes. The monthly totals (`monthlyBurn`) sum per currency, then per category, with `findIndex` and a running total, which TypedPress's type checker follows; an earlier form that reassigned a possibly undefined `find()` result did not compile.

Deleting an owned subscription that has charges returns 200 and cascades to
its charges through `charges.subscriptionId`'s `onDelete("cascade")`. A delete
checks only the rows that reference the deleted row, not whole tables
([decision](../../docs/decisions/2026-11-16-per-row-delete-visibility.md)). The
`Rows in charges may reference this row` refusal now appears only when another
user's hidden charge references the subscription. The earlier runtime refused
every such delete with that 409, as the earlier transcript below records.

With the generated `tp/_generated/db.d.ts` present, `tsc -p examples/subscriptions`
(TypeScript 5.9.3) reports 6 errors on 2026-11-16, counted as lines matching
`error TS`. `type Subscription = InferSelectModel<typeof subscriptions>` is used
inside the `subscriptions` table's own hooks, so TypeScript reports the table as
implicitly `any` (line 9) and the type alias as circular (lines 96 and 98); the
`{ id }` filters at lines 112, 165, and 178 then fail as `TS2353`.
`typedpress check` is unaffected.

The installed `spacefast/0.8.0` CLI also refuses the deploy guide's preflight:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Unknown command `sf typedpress check examples/subscriptions`. Did you mean `sf zero ls`? Run `sf help zero` for available commands.",
    "type": "https://spacefast.com/docs/errors/validation_error",
    "retryable": false,
    "recovery": "Adjust the request, then retry"
  }
}
```

That CLI treated `typedpress.config.ts` as ordinary source files and reported a
file-mode upload, rather than compiling a backend. A publish receipt marked
`ready` does not establish a running TypedPress app.

## Verification

| Check | Result |
|---|---|
| Compiler | `typedpress check examples/subscriptions` passes. |
| HTTP verifier | `scripts/verify.mjs` passed against a local Studio site on 2026-11-16, below. |
| Generated-file freshness | Not checked with `typedpress build --frozen`. |
| Calendar and normalization tests | `node --test examples/subscriptions/tp/lib/calendar.test.mjs` passes. Covers month ends, leap years, year boundaries, and fractional cents. |
| Agent protocol | A real, unchanged pantry `typedpress dev` site listed tools and executed a list tool. Exact output is in [the agent guide](../../docs/agents.md#verify-with-a-real-site). |
| Frontend, reminder job, MCP | Only the earlier disposable contract proof below. Not rerun against the real app. |

A rerunnable HTTP proof is `scripts/verify.mjs`. Against a disposable account,
it creates fixtures, checks CRUD and every action, checks charge history,
request retries, and invalid writes, then deletes its fixtures:

```sh
TP_SITE=http://localhost:8794 TP_APP_PASSWORD="$AUTH" \
  node examples/subscriptions/scripts/verify.mjs
```

It requires the real app's `monthlyBurn`; it does not replace that action with
a stub or skip a failing check. Do not use an account holding real data.

On 2026-11-16, `TP_SITE=<local Studio URL> TP_APP_PASSWORD=admin:<application password>`
against a local Studio site passed and printed:

```text
PASS: collection CRUD, all actions, charge history, idempotency, inactive-charge and owner-input rejection
```

That run checks `monthlyBurn` for one yearly 12000-cent subscription as
`12000 / 12 = 1000` cents in its category. Its cleanup deletes, including
`DELETE /subscriptions/<id>` with a logged charge, returned 200.

### Disposable contract proof (earlier run)

This is an earlier run, from when the full config did not compile. To test the
independent paths despite that build failure, a disposable copy of
this config replaced only `monthlyBurn` with `{ currencies: [] }`, retaining the
same declared output type. `typedpress build` generated its types and plugins. Its
WordPress Studio site ran on `http://localhost:8795`, built with compiler/runtime
`de46201a` before the rebase. The current-main compiler check and pantry MCP proof
were repeated at `ef0a42e3`. Nothing from that generated
fixture is committed as this app's client or migrations.

The complete source passes `tsc` with that fixture's generated schema types.
The frontend's TypeScript and Vite build also pass against those contracts.
This is contract validation, not a successful TypedPress build of the committed app.

Exact HTTP and job outputs are in
[`verification/contract-http.jsonl`](verification/contract-http.jsonl). The probe
used application passwords for separate owner and subscriber accounts.
Category CRUD, subscription create/read/update, `renewingSoon`, `logCharge`,
request replay, `cancel`, reminder stamping, owner isolation, and the currency
history guard passed. `monthlyBurn` returned the fixture's empty stub result;
its calculation was not runtime-verified in that run. REST subscription delete
returned `409` in that run, before the per-row delete check.

The [browser transcript](verification/contract-ui.json) records the Vite proxy,
real sign-in and consent, callback, add/edit, search, charge history, charge
logging, cancellation, and retry after a denied callback. Every measured screen
has `document === viewport === 390` and `smallTargets.length === 0` for visible
buttons, links, inputs, and selects tested at a minimum of 44 × 44 CSS pixels.
`errors.length === 0` records the captured browser errors. The fixture's
`monthlyBurn` stayed empty throughout that browser proof.

The [MCP transcript](verification/contract-mcp.jsonl) also lists the subscription
app's named tools and calls `subscriptions-subscriptions-list` on that fixture.
The action declarations and table schemas match the committed config; the
aggregation implementation is still a stub in this proof.

Representative responses from that earlier run, with the full rows in the transcript:

```text
POST /categories                             201
GET /categories/<id>                         200
PATCH /categories/<id>                       200
POST /subscriptions                          201
GET /subscriptions/<id>                      200
PATCH /subscriptions/<id>                    200
POST /subscriptions with client ownerId       403 forbidden
GET /subscriptions/<id> as another user      404 not_found
POST /actions/renewingSoon                    200
POST /actions/logCharge                      200
POST /actions/logCharge with same key        200, identical response
PATCH /subscriptions/<id> with new currency  409 currency_has_history
POST /actions/cancel                         200, cancelled + vendor URL
POST /actions/logCharge after cancel        409 inactive_subscription
DELETE /subscriptions/<id>                   409 reference_violation
DELETE /categories/<id>                      200
```

## Use it from your agent

The app-specific MCP endpoint is `/wp-json/mcp/typedpress-subscriptions`. Authenticate
with a WordPress application password for your user. It applies the same owner
rules as REST. [Use your TypedPress app from an agent](../../docs/agents.md) has exact
Claude Code, Claude Desktop, and Codex configuration, plus a real MCP transcript.
These subscription ability names follow the shipped runtime registration; MCP
calls were not part of the 2026-11-16 local run, and they are not live-verified.

| Prompt | Ability |
|---|---|
| "What is my monthly spending, grouped by currency and category?" | `subscriptions/monthly-burn` |
| "Show my subscriptions renewing in the next three days." | `subscriptions/renewing-soon` with `{ "days": 3 }` |
| "Mark this subscription cancelled and show me the vendor's cancellation page." | `subscriptions/cancel` with the selected `subscriptionId` |

## Publish

Hosted deployment of a `typedpress.config.ts` project is not available in a
released `spacefast` CLI yet; see the [Spacefast deploy guide](../../docs/spacefast-deploy.md). After publishing, build the frontend,
then verify a collection read, an action, and a complete sign-in on the live
host.
