# Pet food and pantry

A personal pet pantry whose interface is WordPress. Pets and foods have native
wp-admin edit screens with generated Secure Custom Fields groups. Vet notes use
Gutenberg. `admin: true` includes Zero Admin for the SQL tables. There are no
custom frontend components, public assets, pages, or frontend dependencies.

**The app is not running yet.** Main rejects the exported `AccessCtx` type.
The Spacefast CLI published a restricted static source listing instead of a
Zero app. Local actions, admin screenshots, and live app verification are not
done. The exact blockers are recorded below.

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
action database calls are trusted by Zero, so actions explicitly filter by
owner too. Guests cannot use this app.

`foods.afterCreate` creates the shopping-list candidate while the user's actor
is available. Scheduler jobs have no signed-in user. The authenticated enqueue
path supplies the food and owner IDs. The job checks that pair and updates the
existing candidate, preserving its owner. The internal job has `agents: false`.

## Run it locally

From the repository root:

```sh
cargo build --locked
./target/debug/zero check examples/pet-food --json
./target/debug/zero build examples/pet-food
./target/debug/zero dev examples/pet-food --port 8897 --no-watch
```

These commands currently stop at the diagnostic below. Once main accepts the
source, Studio supplies WordPress, SCF, Action Scheduler, and MCP Adapter. Zero
Admin is included by `admin: true`. When installing elsewhere, follow the
generated manifest's activation order and enable pretty permalinks.

Sign in at `http://localhost:8897/wp-admin/` with the disposable local account
`admin` / `zero-test-admin`. Use `/zero-admin/` for Pantry stock, Feeding history,
and Shopping list. Pets, Foods, and Vet notes have native wp-admin menus.
WordPress sign-in needs no custom frontend or OAuth client registration.

Create an application password and run the real HTTP verifier:

```sh
./target/debug/zero dev wp examples/pet-food -- user application-password create admin pet-food-local --porcelain
read -rs 'ZERO_AUTH?WordPress username:application-password: '; echo
export ZERO_AUTH
ZERO_SITE=http://localhost:8897 node examples/pet-food/verify.mjs
```

`verify.mjs` prints commands with credential variables and actual JSON responses.
It creates Miso, salmon kibble, stock, and a vet note. It exercises pet CRUD and
every action, owner spoofing, idempotent replay, and rollback after refused
feedings. Set `ZERO_OTHER_AUTH` to another WordPress user's application-password
credential to include cross-user reads, writes, actions, and reference checks.
It retains fixtures for screenshots. Reruns create independent fixtures.

After the verifier succeeds, execute the queued Action Scheduler jobs:

```sh
./target/debug/zero dev wp examples/pet-food -- action-scheduler run --group=zero-pet-food --force
./target/debug/zero dev wp examples/pet-food -- zero jobs list
curl --fail-with-body -u "$ZERO_AUTH" 'http://localhost:8897/wp-json/zero/v1/shopping_list'
unset ZERO_AUTH ZERO_OTHER_AUTH
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
curl --get --fail-with-body -u "$ZERO_AUTH" \
	--data-urlencode 'where={"needed":true}' \
	'http://localhost:8897/wp-json/zero/v1/shopping_list'
```

## Customize the admin

Edit [lib/schema.ts](lib/schema.ts), then rebuild:

| Change | Mechanism |
| --- | --- |
| Field groups | Add fields to a post-backed `collection()`. Zero regenerates its SCF group. `.ui({ label, help, placeholder, width })` configures supported SCF controls. Edit the schema rather than its generated local SCF group. |
| Labels | Change a resource's `label` for menus and screens. Use field `.ui()` labels independently of API names. |
| Title and Gutenberg | `title` chooses the native post title. `content` chooses the rich-text field rendered in Gutenberg. Pets and Foods use SCF forms without a block-editor body. |
| List columns | Zero Admin derives fields from the schema and lets you choose visible columns in its table view. Classic wp-admin uses native title/date columns. Main has no per-resource option for custom classic list columns or their order. |
| Menus | Register collections for native wp-admin menus and tables for Zero Admin. Access rules determine the data users can reach. Main has no separate menu-visibility option. |
| Icons | Main hardcodes `dashicons-database` for generated post types. There is no supported per-resource icon option. |

`ownerId` cannot be updated through clients. Hiding a menu never changes access
rules. Keep reference ownership checks when adding relations. Review generated
SQL before applying field removals or type changes to existing personal data.

## Use it from your agent

MCP endpoint: `/wp-json/mcp/zero-pet-food`. Authenticate with HTTP Basic using
your WordPress username and an application password from **Users > Profile >
Application passwords**. Store it in your agent's secret settings. The hosted
Space's team-access gate is separate from WordPress authorization.

The names come from the server registration and kebab-case naming in
[`runtime/Zero/Wp/Abilities/Register.php`](../../runtime/Zero/Wp/Abilities/Register.php).
The failed build has not emitted a plugin, so generated-plugin discovery and
execution of these abilities are not verified.

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

Screenshots are not captured. The build fails before Studio creates this app,
so its actual screens cannot be photographed. These requested views are not
verified:

| View | Route |
| --- | --- |
| Native Pets list | `/wp-admin/edit.php?post_type=zero_pets` |
| Pet edit screen with SCF fields | `/wp-admin/post.php?post=ID&action=edit`, using a real pet's WordPress post ID |
| Zero Admin stock table | `/zero-admin/`, then Pantry stock |

## Known gaps on main (b66e98b3866037061198c51ebef9534609a5e301)

The native compiler was rebuilt from this revision with `cargo build --locked`.
`zero check --json` emits one error, counted from `diagnostics` filtered by
`severity == "error"`. It stops at the first blocker; later compilation stages
are not proven error-free.

At `lib/schema.ts:6`, the source is `export function owned(ctx: AccessCtx) {`.
`AccessCtx` is exported by `types/zero/index.d.ts`, but the callback compiler
does not recognize the imported type. `zero build` prints this verbatim:

```text
error: unknown type `AccessCtx`
  --> lib/schema.ts:6:28
  |
6 | export function owned(ctx: AccessCtx) {
  |                            ^^^^^^^^^
```

`zero dev examples/pet-food --port 8897 --no-watch` prints that diagnostic,
followed by:

```text
zero dev: Failed (1): build
```

Generated `zero/client/`, `zero/migrations/`, `zero.gen.ts`, and plugin locks
are absent because the build exits before emission. They have not been
handwritten. The local collection probe reports `fetch failed: ECONNREFUSED`.
`verify.mjs` passed `node --check` only. Local actions, CRUD, the scheduler,
SCF saves, and Gutenberg editing remain unverified.

| Other gap on main | Consequence |
| --- | --- |
| `Db::update()` selects with the filter, then `WpTableStore::update()` writes by primary key only. | The `gramsLeft` predicate in `feed` is not atomic compare-and-set. Distinct concurrent meals can spend the same stock. Idempotency only protects replay of the same meal. Concurrent stock safety requires a runtime change outside this example. |
| `Abilities\\Invoke::call()` invokes actions without forwarding request headers. | MCP `feed` retries do not carry the REST idempotency key and can double-log meals. |
| Fixed menu icon and no per-resource classic list-column or menu-visibility settings. | Labels and SCF forms are configured here; those presentation requests need support in Zero. |
| SCF marks readable `ownerId` as a required number field and does not render `update: false` as readonly. | The server assigns and preserves ownership, but the generated form still asks for an owner number. A clean server-assigned ownership form needs renderer support; its browser behavior is unverified. |
| Public WordPress media URLs. | Owner filters on rows do not make uploaded pet or pack photos private. Qualify host media access before uploading sensitive photos. |

## Spacefast attempt

Space: <https://pet-food.space.fast/>. Destination team was resolved and checked
as `spacefast-examples`, ID `team_b65faad473cf46189230addaade3991a`.

The installed `spacefast/0.8.0` CLI rejected the documented `sf zero check`
preflight with this exact message:

```text
Unknown command `sf zero check`. Did you mean `sf zero ls`? Run `sf help zero` for available commands.
```

From `examples/pet-food`, publication used the requested CLI and team access:

```sh
sf publish --team team_b65faad473cf46189230addaade3991a \
	--name 'Pet food' --slug pet-food --access team --json
```

The receipt activated `ver_43e08afcf4104c9d8466bc5ab6b9ffb7`, but included this
diagnostic verbatim:

```text
No HTML files were found in the root of this version, so it serves in files mode with directory listing enabled.
```

Reading the Space confirms its destination team and `hasRuntime: false`.
This is a restricted static source publication, not a deployed pet pantry.
No personal records were uploaded. Anonymous collection and action requests
returned 403 with `This space is private`.

`sf share list` exposed an additional managed link grant named `Open`. It was
revoked with `sf share revoke`, then the active grants were checked again.
The remaining active grants allow the owning team on live and version URLs.

Authenticated platform probes used:

```sh
sf fetch /wp-json/zero/v1/pets --space spc_429d2abd17024946a1cda69e5322ed2c --status --json
sf fetch /wp-login.php --space spc_429d2abd17024946a1cda69e5322ed2c --status --json
sf fetch /wp-admin/ --space spc_429d2abd17024946a1cda69e5322ed2c --status --json
```

| Probe | Actual response fields | Meaning |
| --- | --- | --- |
| Collection | `"status":404,"contentType":"application/json; charset=UTF-8","versionId":null` | App collection route absent after authenticated platform access. |
| Sign-in page | `"status":200,"contentType":"text/html; charset=UTF-8","versionId":null` | Host page reachable. App WordPress sign-in not verified. |
| Admin page | `"status":200,"contentType":"text/html; charset=UTF-8","versionId":null` | Host page reachable. App SCF and Zero Admin not verified. |

The action attempt was:

```sh
sf zero call pet-food/restock-list --space spc_429d2abd17024946a1cda69e5322ed2c --input '{}' --json
```

It returned `validation_error` with this exact message:

```text
This space has no machine credential to call an Ability with. Create one with `sf share token create`, then pass --credential.
```

A subsequent Node `fetch` probe used an author handoff from
`sf open spc_429d2abd17024946a1cda69e5322ed2c --show-secret --json`, keeping
the handoff and cookies in memory. It made the actual collection read and
action POST with authenticated Space access. These are its exact responses:

```json
{"method":"GET","path":"/wp-json/zero/v1/pets","status":404,"body":{"code":"rest_no_route","message":"No route was found matching the URL and request method.","data":{"status":404}}}
{"method":"POST","path":"/wp-json/zero/v1/actions/restockList","status":404,"body":{"code":"rest_no_route","message":"No route was found matching the URL and request method.","data":{"status":404}}}
```

Live app reads and actions fail; WordPress sign-in remains unverified. A
working compiler and a CLI that captures this Zero config are required before
the app can be deployed and its screenshots and behavior verified.
