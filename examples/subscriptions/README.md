# Subscriptions

A personal subscription tracker with a React SPA. Track renewal dates, payment
labels, categories, and charge history. Each row belongs to the signed-in
WordPress user.

**This example does not compile on current main.** The compiler diagnostic below
prevents emitting fresh migrations and a typed client. The frontend uses the
generated-client API, but the final app cannot start yet. No generated substitute
or compiler patch is committed.

## What it shows

| Piece | Behavior |
|---|---|
| `subscriptions`, `charges`, `categories` | Plain tables with owner filters on every read, update, and delete. Creation stamps `ownerId` from the authenticated user. Client writes cannot set ownership. |
| `monthlyBurn` | Active subscriptions only. Sum cents per currency and category: weekly × 52 ÷ 12, monthly unchanged, yearly ÷ 12. Round each resulting total after summing. Currencies stay separate. |
| `renewingSoon({ days })` | Active subscriptions owned by the caller, from today's UTC date through today + `days`, inclusive, ordered by renewal date. Overdue rows remain visible in the list. |
| `logCharge({ subscriptionId })` | Store the current amount on the scheduled renewal date, then advance by one cycle. Calendar months and years clamp to the last valid day. This records a charge; it does not charge a payment provider. Inactive subscriptions are rejected. |
| `cancel({ subscriptionId })` | Mark the subscription cancelled and return its cancellation URL. The user must still cancel with the vendor. |
| `remindRenewal` | One stock Action Scheduler job. Enqueue on active subscription writes, delayed until three days before renewal or immediately if already due. Stamp `remindedAt`. Stale jobs for another renewal date or an inactive subscription do nothing. No email or custom cron. |
| React SPA | Overview with monthly spending and category totals, upcoming renewals, a filtered list, an add/edit sheet, and detail with charge history. Uses first-identity and the generated typed client. |

The charge action uses `once()` per subscription and observed renewal date to
serialize concurrent attempts, plus `idempotent: true` for request retries.
The frontend sends an `Idempotency-Key` for that renewal. Currency changes are
rejected once charges exist, so old amounts keep their original denomination.
Payment methods are labels, never card numbers or payment credentials.

## Run locally

These commands require the compiler gap below to be resolved. Use a compiler
built from this repository. `first build` and `first dev` manage the required
plugins and their activation.

```sh
cargo build --locked
./target/debug/first build examples/subscriptions
npm --prefix examples/subscriptions/web ci
npm --prefix examples/subscriptions/web run build
./target/debug/first build examples/subscriptions
./target/debug/first dev examples/subscriptions --no-watch --port 8794
./target/debug/first identity --site examples/subscriptions app add \
  --name=Subscriptions --id=app_subscriptions \
  --redirect=http://localhost:8794/wp-content/plugins/first-app-subscriptions/public/index.html \
  --origin=http://localhost:8794
```

Open `http://localhost:8794/wp-content/plugins/first-app-subscriptions/public/index.html`.
Use the URL and port Studio actually prints. The explicit `index.html` path
also works on Studio hosts that do not serve plugin directory indexes.
The sign-in button calls `auth.signIn()`; the callback calls `handleCallback()`.
The frontend stores no application password.

For the Vite loop, register its origin and callback, then start Vite:

```sh
./target/debug/first identity --site examples/subscriptions app add \
  --name=Subscriptions --id=app_subscriptions_vite \
  --redirect=http://127.0.0.1:5173/ --origin=http://127.0.0.1:5173
VITE_ZERO_APP_ID=app_subscriptions_vite npm --prefix examples/subscriptions/web run dev
```

Keep `first dev examples/subscriptions --port 8794` running in another terminal
without `--no-watch` to rebuild backend changes. Vite proxies `/wp-json` to
`http://localhost:8794`; set `FIRST_DEV_URL` if Studio uses another address. Vite
builds into `../public/` with relative asset URLs for plugin and Space hosting.
React, React DOM, Vite, and the TypeScript editor dependencies have exact pins
and an npm lockfile.

`public/` is ignored. The [deploy guide](../../docs/spacefast-deploy.md) says
static files are published as they are, and does not require committing Vite
output. Run `npm --prefix web ci && npm --prefix web run build` from this
example before publishing. A successful First build must also commit
`first/client/`, `first/_generated/migrations/`, `first.gen.ts`, and `first/wp-plugins.lock.json`.
They cannot be generated from this config while the diagnostic remains.

## Known gaps on main (ef0a42e3883eb146ad6318ff32cbc54cdb2e31d1)

`./target/debug/first check examples/subscriptions --json` exits 1. The error
count is `diagnostics.filter(d => d.severity === "error").length = 1` in
[`verification/compiler.json`](verification/compiler.json). The diagnostic is
verbatim:

```text
can't insert { currency: string; amount: number; categories: { category: string; amount: number }[] } | undefined into an array of { currency: string; amount: number; categories: { category: string; amount: number }[] }
  --> first.config.ts:143:13
143 |             currencies.push(total);
```

The source first assigns a new group inside `if (!total)`, then pushes it.
TypeScript accepts this control flow. Main's First compiler retains the old
`undefined` alternative. The aggregation is preserved to expose the gap.
`first dev examples/subscriptions --no-watch --port 8795` stops at the same
build diagnostic with `first dev: Failed (1): build`.

The disposable site also returns this runtime diagnostic on the owned
subscription delete path. It is triggered by the `charges.subscriptionId`
reference and owner-filtered table access in `first.config.ts`:

```json
{"type":"about:blank","title":"Reference violation","status":409,"code":"reference_violation","detail":"Rows in charges may reference this row"}
```

`Db::requireReferenceVisibility()` requires full child-table visibility before
cascading a delete. The owner rule intentionally filters that table. The app
keeps its foreign key and private access rules. Its cancel action still works.

Earlier authoring diagnostics are retained here for completeness. They no
longer occur in the final source, which uses contextual table access callbacks
and captures `ctx.user` before mutating hook data:

```text
first.config.ts:11:10
read: (ctx: { user: { id: number } | null }) => ...
this parameter is declared as { user: { id: number } | null }, but it receives { user: { id: number; name: string; role: "guest" | "subscriber" | "author" | "editor" | "admin" } | null; op: string; data?: Record<string, unknown> | null }
help: accept the supplied argument type, or change the values supplied to the function

first.config.ts:11:15
read: (ctx: AccessCtx) => ...
unknown type `AccessCtx`

first.config.ts:103:114
const subscription = await db.query.subscriptions.findFirst({ where: { id: data.subscriptionId, ownerId: ctx.user.id } });
can't read `id`: this might be null ({ id: number; name: string; role: "guest" | "subscriber" | "author" | "editor" | "admin" } | null)
help: check it first, or use `?.`
```

The installed `spacefast/0.8.0` CLI also refuses the deploy guide's preflight:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Unknown command `sf first check examples/subscriptions`. Did you mean `sf zero ls`? Run `sf help zero` for available commands.",
    "type": "https://spacefast.com/docs/errors/validation_error",
    "retryable": false,
    "recovery": "Adjust the request, then retry"
  }
}
```

That CLI treated `first.config.ts` as ordinary source files and reported a
file-mode upload, rather than compiling a backend. A publish receipt marked
`ready` does not establish a running First app.

## Verification

| Check | Result |
|---|---|
| Main compiler | Blocked by the diagnostic above. |
| Final app startup and generated-file freshness | Blocked by compilation. |
| Calendar and normalization tests | `node --test examples/subscriptions/lib/calendar.test.mjs` passes. Covers month ends, leap years, year boundaries, and fractional cents. |
| Agent protocol | A real, unchanged pantry `first dev` site listed tools and executed a list tool. Exact output is in [the agent guide](../../docs/agents.md#verify-with-a-real-site). |
| Frontend and other runtime paths | See the disposable contract proof below. It does not establish that the final app compiles. |

A rerunnable HTTP proof is `scripts/verify.mjs`. Against a disposable account,
it creates fixtures, checks CRUD and every action, checks charge history,
request retries, and invalid writes, then deletes its fixtures:

```sh
FIRST_SITE=http://localhost:8794 FIRST_APP_PASSWORD="$AUTH" \
  node examples/subscriptions/scripts/verify.mjs
```

It requires the real app's `monthlyBurn`; it does not replace that action with
a stub or skip a failing check. Do not use an account holding real data.

### Disposable contract proof

To test the independent paths despite the build failure, a disposable copy of
this config replaced only `monthlyBurn` with `{ currencies: [] }`, retaining the
same declared output type. `first build` generated its types and plugins. Its
WordPress Studio site ran on `http://localhost:8795`, built with compiler/runtime
`de46201a` before the rebase. The current-main compiler check and pantry MCP proof
were repeated at `ef0a42e3`. Nothing from that generated
fixture is committed as this app's client or migrations.

The complete source passes `tsc` with that fixture's generated schema types.
The frontend's TypeScript and Vite build also pass against those contracts.
This is contract validation, not a successful First build of the committed app.

Exact HTTP and job outputs are in
[`verification/contract-http.jsonl`](verification/contract-http.jsonl). The probe
used application passwords for separate owner and subscriber accounts.
Category CRUD, subscription create/read/update, `renewingSoon`, `logCharge`,
request replay, `cancel`, reminder stamping, owner isolation, and the currency
history guard passed. `monthlyBurn` returned the fixture's empty stub result;
its calculation was not runtime-verified. REST subscription delete returned the
known `409`; trusted local WP-CLI removed only the probe's fixture rows.

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

Representative responses, with the full rows in the transcript:

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

The app-specific MCP endpoint is `/wp-json/mcp/first-subscriptions`. Authenticate
with a WordPress application password for your user. It applies the same owner
rules as REST. [Use your First app from an agent](../../docs/agents.md) has exact
Claude Code, Claude Desktop, and Codex configuration, plus a real MCP transcript.
These subscription ability names follow the shipped runtime registration; they
are not claimed as live-verified while this example cannot build.

| Prompt | Ability |
|---|---|
| "What is my monthly spending, grouped by currency and category?" | `subscriptions/monthly-burn` |
| "Show my subscriptions renewing in the next three days." | `subscriptions/renewing-soon` with `{ "days": 3 }` |
| "Mark this subscription cancelled and show me the vendor's cancellation page." | `subscriptions/cancel` with the selected `subscriptionId` |

## Publish and live status

After resolving the compiler and CLI gaps, build the frontend, run `sf first
check` from this directory, and publish to a new team-only Space with an explicit
resolved team ID:

```sh
sf publish examples/subscriptions --team <resolved-team-id> --access team --name Subscriptions --json
```

Resolve `spacefast-examples` by its slug and verify the resulting Space's team
ID. A different team has the same display name, so a name-only match is unsafe.
Verify a collection read, an action, and a complete sign-in on the live host.

The attempted upload is at https://subscriptions-xxkvwx6gw.space.fast/ . It is
restricted to its owning team. The installed CLI selected the other team with
the same name. Its open-link grant was revoked and the remaining grants were
read back. The requested destination remains unmet. An attempted correction
was refused with this exact API error:

```text
403 forbidden
This credential can read this space but does not allow spaces:transfer. Use a credential with spaces:transfer for this space, or ask a signed-in team owner or admin to transfer it. The member who created the space can also transfer it from the dashboard while nobody else has published to it. Operation approval does not expand credential permissions.
```

Live HTTP probes returned `403` and the Space access page for
`GET /wp-json/first/v1/subscriptions`,
`POST /wp-json/first/v1/actions/monthlyBurn` with `{}`, and
`GET /wp-json/first/v1/auth/config`. This verifies the access gate only.
Subscription CRUD, actions, and first-identity sign-in are **not verified live**.
No staging or production infrastructure was changed by hand.
