# Pet food and pantry

A personal pet pantry whose interface is WordPress. Pets and foods have native
wp-admin edit screens with generated Secure Custom Fields groups. Vet notes use
Gutenberg. TypedPress Admin, which every build includes, edits the SQL tables. There are no
custom frontend components, public assets, pages, or frontend dependencies.

On 2026-11-16, `typedpress check` passed and `verify.mjs` passed end to end, with the runtime fix for [#533](https://github.com/spacefast/zero/issues/533),
against a local Studio site, including the second-user isolation checks. The
Action Scheduler shopping-list job, SCF saves, Gutenberg editing, MCP calls, and
admin screenshots were not verified in that run. The Spacefast CLI published a
restricted static source listing instead of a TypedPress app, so nothing is
verified live. The remaining gaps are recorded below.

## Storage choices

| Entity | Storage | Why |
| --- | --- | --- |
| `pets` | `collection()` | Named profiles with media photos, native edit screens, and revisions. `name` is the post title. |
| `foods` | `collection()` | A product catalog edited through SCF, with pack photos and revisions. `product` is the post title. |
| `vetNotes` | `collection()` | Editorial content. `title` maps to the post title and `body: richText()` maps to Gutenberg content. Each note references a pet. |
| `stock` | `table()` | Pack balances and opening/expiry dates are operational records without publishing or revisions. Each pack references a food. |
| `feedings` | `table()` | An append-only ledger written by `feed`, including a meal price snapshot. Generic create, update, and delete are denied. |
| `shoppingList` | `table()` | One candidate per food. Action Scheduler marks candidates that need restocking. Clients cannot mutate the background job's results. |

Every row has an `ownerId` assigned by `beforeCreate` from the signed-in
WordPress user, overwriting client input. Read, update, and delete rules return
an owner filter. Reference hooks reject another user's pets and foods. Internal
action database calls are trusted by TypedPress, so actions explicitly filter by
owner too. Guests cannot use this app.

`foods.afterCreate` creates the shopping-list candidate while the user's actor
is available. Scheduler jobs have no signed-in user. The authenticated enqueue
path supplies the food and owner IDs. The job checks that pair and updates the
existing candidate, preserving its owner. The internal job has `agents: false`.

## Run it locally

From the repository root:

```sh
cargo build --locked
./target/debug/typedpress check examples/pet-food --json
./target/debug/typedpress build examples/pet-food
./target/debug/typedpress dev examples/pet-food --port 8897 --no-watch
```

`typedpress build` writes `tp/_generated/client/`, `tp/_generated/migrations/`,
`tp/_generated/db.d.ts`, and the plugin lock. Studio supplies WordPress, SCF, Action Scheduler, and MCP Adapter. TypedPress
Admin is included in every build. When installing elsewhere, follow the
generated manifest's activation order and enable pretty permalinks.

Sign in at `http://localhost:8897/wp-admin/` with the disposable local account
`admin` / `typedpress-test-admin`. Use `/wp-admin/new/` for Pantry stock, Feeding history,
and Shopping list. Pets, Foods, and Vet notes have native wp-admin menus.
WordPress sign-in needs no custom frontend or OAuth client registration.

Create an application password and run the real HTTP verifier:

```sh
./target/debug/typedpress wp --site examples/pet-food user application-password create admin pet-food-local --porcelain
read -rs 'TP_AUTH?WordPress username:application-password: '; echo
export TP_AUTH
TP_SITE=http://localhost:8897 node examples/pet-food/verify.mjs
```

`verify.mjs` reads `TP_SITE` (the site URL, without credentials), `TP_AUTH`
(`username:application-password`), and optionally `TP_OTHER_AUTH` (a second
WordPress user's credential). It prints each request as a `curl` command with
credential variables, followed by the actual status and JSON response. It checks:

- the application password signs in through `/wp-json/wp/v2/users/me`;
- pet create, update, read, and delete, with a spoofed `ownerId` overwritten by
  the signed-in user;
- creating a food, a stock pack, and a vet note, all stamped with that owner;
- guests get 401 or 403 on the pet list and on `feed`;
- `feed` logs one meal with the captured price; a replay with the same
  `Idempotency-Key` returns the saved response without subtracting stock or
  logging a second feeding;
- a meal larger than the stock and a meal in the future are refused, leaving
  stock and the feeding log unchanged;
- `runsOutOn` uses 14-day consumption, `costPerMonth` equals
  `round(80 * 1200 / 1000 / 14 * 30)` cents, and `restockList` includes the
  low-stock food;
- with `TP_OTHER_AUTH`: the second user cannot list or read the owner's pets,
  foods, stock, vet notes, or feedings, cannot update or delete the pet, cannot
  call `feed`, `runsOutOn`, or `costPerMonth` on them, cannot add stock or a vet
  note against them, and does not see the food in their own `restockList`; the
  owner's pet and stock are unchanged afterwards.

It ends by printing `{"verified":true,...}` with the fixture IDs. Without
`TP_OTHER_AUTH` it says the second-user checks were not run. It retains
fixtures for screenshots. Reruns create independent fixtures.

On 2026-11-16 a run with `TP_SITE`, `TP_AUTH=admin:<application password>`, and
`TP_OTHER_AUTH=other:<application password>` against a local Studio site passed
and printed `{"verified":true,...}`. The temporary pet's delete returned 200.

After the verifier succeeds, execute the queued Action Scheduler jobs:

```sh
./target/debug/typedpress wp --site examples/pet-food action-scheduler run --group=typedpress-pet-food --force
./target/debug/typedpress jobs list --site examples/pet-food
curl --fail-with-body -u "$TP_AUTH" 'http://localhost:8897/wp-json/typedpress/v1/shopping_list'
unset TP_AUTH TP_OTHER_AUTH
```

The salmon candidate must have `needed: true` and a non-null `checkedAt`.
Observing an enqueue response alone does not verify the job. A normal host
must run WP-Cron so Action Scheduler can deliver jobs.

## Actions and formulas

| Action | Input | Behavior |
| --- | --- | --- |
| `feed` | `petId`, `foodId`, `grams`, optional `fedAt` | Checks ownership, rejects future times and insufficient unexpired stock, subtracts across packs, opens a pack when first used, and logs one feeding. Use a fresh `Idempotency-Key` per meal and reuse it when retrying that meal. |
| `runsOutOn` | `foodId` | Returns usable grams, recent daily consumption, days remaining, a projected UTC date, and whether restocking is needed. |
| `costPerMonth` | `petId` | Returns a monthly estimate in cents using prices captured when feeding. |
| `restockList` | `{}` | Returns foods with no usable stock or at most a week remaining and queues shopping-list checks. |

History uses `now - 14 days <= fedAt <= now`, filtered by owner and the selected
food or pet. All prices must use one currency.

| Value | Formula and filters |
| --- | --- |
| Usable grams | Sum positive `stock.gramsLeft` for the owner and food, with no expiry or `expiresOn >= today`, using UTC dates. |
| Grams per day | Sum grams served for the food in the history window, divided by 14. The pet's `dailyGrams` is a target, not measured history. |
| Runs out on | `now + usable grams / grams per day`, converted from days to milliseconds, then formatted as a UTC date. Positive stock without consumption history returns null. Empty usable stock returns today. |
| Meal cost | `grams * food.costCents / food.bagGrams`, saved as fractional cents. |
| Monthly cost | `round(sum of the pet's meal costs in the history window / 14 * 30)`. |
| Restock | Usable grams equal zero, or measured days remaining are at most 7. |

Short histories still use the full window. Estimates can be low during setup.
Backdated feedings consume today's stock. Forecasts exclude packs already
expired but do not predict future waste. Pack selection orders by expiry then
ID; null expiry follows the database's null ordering.

The scheduler refreshes stored candidates after food creation, stock changes, and after
`feed` or `restockList`. It has no daily sweep. If only time passes, run
`restockList` to refresh expiry and history-window changes. The table includes
all candidates; filter `needed: true` to read the current shopping list:

```sh
curl --get --fail-with-body -u "$TP_AUTH" \
	--data-urlencode 'where={"needed":true}' \
	'http://localhost:8897/wp-json/typedpress/v1/shopping_list'
```

## Customize the admin

Edit [tp/lib/schema.ts](tp/lib/schema.ts), then rebuild:

| Change | Mechanism |
| --- | --- |
| Field groups | Add fields to a post-backed `collection()`. TypedPress regenerates its SCF group. `.ui({ label, help, placeholder, width })` configures supported SCF controls. Edit the schema rather than its generated local SCF group. |
| Labels | Change a resource's `label` for menus and screens. Use field `.ui()` labels independently of API names. |
| Title and Gutenberg | `title` chooses the native post title. `content` chooses the rich-text field rendered in Gutenberg. Pets and Foods use SCF forms without a block-editor body. |
| List columns | TypedPress Admin derives fields from the schema and lets you choose visible columns in its table view. Classic wp-admin uses native title/date columns. Main has no per-resource option for custom classic list columns or their order. |
| Menus | Register collections for native wp-admin menus and tables for TypedPress Admin. Access rules determine the data users can reach. Main has no separate menu-visibility option. |
| Icons | Main hardcodes `dashicons-database` for generated post types. There is no supported per-resource icon option. |

`ownerId` cannot be updated through clients. Hiding a menu never changes access
rules. Keep reference ownership checks when adding relations. Review generated
SQL before applying field removals or type changes to existing personal data.

## Use it from your agent

MCP endpoint: `/wp-json/mcp/typedpress-pet-food`. Authenticate with HTTP Basic using
your WordPress username and an application password from **Users > Profile >
Application passwords**. Store it in your agent's secret settings. The hosted
Space's team-access gate is separate from WordPress authorization.

The names come from the server registration and kebab-case naming in
[`runtime/TypedPress/Wp/Abilities/Register.php`](../../runtime/TypedPress/Wp/Abilities/Register.php).
Generated-plugin discovery and execution of these abilities are not verified.

| Prompt | Abilities |
| --- | --- |
| "Claude, I just fed Miso 80g of the salmon kibble." | Find IDs with `pet-food/pets-list` and `pet-food/foods-list`, then call `pet-food/feed` once for that meal. |
| "When will the salmon kibble run out, and what should I buy?" | `pet-food/foods-list`, `pet-food/runs-out-on`, and `pet-food/restock-list`. |
| "What does Miso's food cost per month? Show me the latest vet notes too." | `pet-food/pets-list`, `pet-food/cost-per-month`, and `pet-food/vet-notes-list`. |

Collections and tables expose their permitted CRUD abilities by default.
`checkLowStock` is internal. Agents must log meals through `feed`; generic
feeding mutations are denied.

Main's ability adapter does not forward `Idempotency-Key` to the action. A
repeated MCP `feed` call can log a meal twice. Header-based replay protection
applies to direct REST calls; safe automatic MCP retries are a known gap.

## Admin screenshots

Screenshots are not captured. These requested views are not verified:

| View | Route |
| --- | --- |
| Native Pets list | `/wp-admin/edit.php?post_type=tp_pets` |
| Pet edit screen with SCF fields | `/wp-admin/post.php?post=ID&action=edit`, using a real pet's WordPress post ID |
| TypedPress Admin stock table | `/wp-admin/new/`, then Pantry stock |

## Known gaps

`typedpress check examples/pet-food` passes. Earlier versions of this README
recorded an `unknown type AccessCtx` error at `tp/lib/schema.ts:6`; the
current compiler accepts the imported type, and `typedpress build` emits the
generated client, migrations, `db.d.ts`, and plugin lock.

**Open gap ([#533](https://github.com/spacefast/zero/issues/533)):** on main, deleting a row that another table can reference returns `409 reference_violation` (`Rows in X may reference this row`) over HTTP, even when nothing references it, because the owner filter can't read the whole referencing table. Here that is deleting a pet (vet notes and feedings reference it). The verifier passes on the branch that fixes this; on main it stops at that delete, and CI marks it expected-fail with the issue number.

| Gap on main | Consequence |
| --- | --- |
| `Db::update()` selects with the filter, then `WpTableStore::update()` writes by primary key only. | The `gramsLeft` predicate in `feed` is not atomic compare-and-set. Distinct concurrent meals can spend the same stock. Idempotency only protects replay of the same meal. Concurrent stock safety requires a runtime change outside this example. |
| `Abilities\\Invoke::call()` invokes actions without forwarding request headers. | MCP `feed` retries do not carry the REST idempotency key and can double-log meals. |
| Fixed menu icon and no per-resource classic list-column or menu-visibility settings. | Labels and SCF forms are configured here; those presentation requests need support in TypedPress. |
| SCF marks readable `ownerId` as a required number field and does not render `update: false` as readonly. | The server assigns and preserves ownership, but the generated form still asks for an owner number. A clean server-assigned ownership form needs renderer support; its browser behavior is unverified. |
| Public WordPress media URLs. | Owner filters on rows do not make uploaded pet or pack photos private. Qualify host media access before uploading sensitive photos. |

## Spacefast

Hosted deployment of a `typedpress.config.ts` project is not available in a
released `spacefast` CLI yet; see the [Spacefast deploy guide](../../docs/spacefast-deploy.md). After publishing, verify a collection
read, an action and WordPress sign-in on the live origin.
