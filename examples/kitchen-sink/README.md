# Community Kitchen

The kitchen sink is a teaching kitchen with workshops, recipes, a journal, a handbook, staff tools, and a small WooCommerce shop. It uses every authoring feature TypedPress has, each for something the kitchen needs, and a test fails when one is missing.

```sh
typedpress dev examples/kitchen-sink
```

Open the URL printed by `typedpress dev`. Sign in with the local development account to reserve a seat, leave a comment, or open the staff tools. The native WooCommerce checkout uses cash on delivery for kitchen pickup.

| Where | What to try |
| --- | --- |
| `/`, `/find` | Paginated workshops, search, and a client component that tracks open registrations |
| `/events/bread-basics` | A synced workshop with its host, ingredients, tips, poster, gallery and handout; live registration status; the reservation and cancellation forms; comments |
| `/recipes`, `/recipes/weekday-sourdough` | A second post-shaped kind with topics from a taxonomy, read by cursor through the kind API |
| `/journal/feeding-a-starter`, `/handbook`, `/feed/` | Native WordPress posts, Markdown sync, handbook navigation, and WordPress's feed |
| `/visits/saturday`, `/about` | A prerendered route with static params and a Markdown page |
| `/contact` | A client component that posts to the native contact form |
| `/staff`, `/wp-admin/new/screens/schedule` | An editor guard, the kitchen log, an announcement form, a form that calls a WordPress Ability, an admin screen with four actions, and the generated API reference |
| `/api/schedule`, `/api/registration` | Public schedule JSON and a signed webhook that closes a workshop |
| `/shop`, `/supplies/bench-scraper`, `/cart`, `/checkout` | Woo products with their own pages, the cart, and the native Checkout Block |
| `/wp-login.php`, `/wp-json/mcp/typedpress-kitchen-sink` | An app login component with a notice from a WordPress hook, and the app's MCP server |

## Where each feature lives

| File | What it shows |
| --- | --- |
| `tp/schema.ts` | Every field builder and modifier; a collection with all seven hooks; `wp.posts.extend` and `wp.posts.clone`; a taxonomy; a hierarchical kind; a user projection; tables with a compound index and an access rule that returns a filter; a global; a private file bucket |
| `tp/server.ts` | A job with `once`; actions that insert, update and delete through `db`, the kind API from `"typedpress:db"`, a global, WordPress functions and a WordPress Ability; a React Email message; an admin screen |
| `emails/reservation.tsx` | The reservation mail, rendered with `mail.render` and previewed with `email dev` |
| `tp/app/` | Pages, layouts, guards, search parameters, forms with `useFormState`, a live region, `error.tsx`, `not-found.tsx`, `login.tsx`, route handlers, a CSS module, an SVG and a stylesheet |
| `tp/components/` | Client components: state, effects, a `useRef` attached with `ref=`, shared state, a live read, a `fetch` |
| `tp/wp-hooks/` | Two WordPress filters: the feed's excerpt ending and the sign-in notice |
| `tp/plugins/kitchen-policy` | A plugin package whose hook writes each recipe's allergen notice |
| `tp/shop.ts` | The store, its products with a `url`, categories, tags and orders |
| `typedpress.config.ts` | Media sizes, uploads, a pinned WordPress plugin, webhooks, the contact form under `services`, and the site switches |

Reservation mail goes to the signed-in member's own address, never to one typed into a form. It is sent from `noreply@` the site's host, or from the address in Kitchen settings; on a local site whose host is `127.0.0.1` or `localhost` that default is `noreply@typedpress.localhost`.

`tp/_generated/migrations/` holds two migrations on purpose: the first build stored the log's text as `message`, and the second renames it to `summary` through `.was("message")`.

## Settings

| Variable | Purpose |
| --- | --- |
| `KITCHEN_REGISTRATION_SECRET` | Signs calls to `/api/registration` |
| `KITCHEN_WEBHOOK_URL`, `KITCHEN_WEBHOOK_SECRET` | Where workshop changes are sent, and their signing secret |
| `KITCHEN_CONTACT_TO`, `KITCHEN_CONTACT_FROM` | The contact form's recipient and sender |
| `TP_SERVICES_RATE_SECRET` | Hashes visitor addresses for the contact form's rate limit |

## What it leaves out

Six things cannot live in this app, and `tests/kitchen_sink.rs` lists each with its reason: locales (turned off in normal builds), `output: "static"` (the app has guarded and request-time pages), `frontend` (the app renders its own pages), `admin: false` (the schedule screen needs TypedPress Admin), `sealed` (an example should accept other plugins), and `runtimeSchema` (the example commits no schema changes made on a site).

## Tests

```sh
cargo test --test kitchen_sink -- --nocapture
tsc -p examples/kitchen-sink
```

The first test reads the type declarations and requires this example to use every exported value, every method of `db`, `mail`, `wp.posts`, the kind API and the column builder, every collection hook, every `defineConfig` key and every page export. A name in a comment or `void x` does not count. A new export fails that test until this example uses it or the test's allowlist says why it cannot. The second test builds the example, then drives it on WordPress with the theme active: every route, the reservation form as a signed-in subscriber, the mail it queues, the hooks, the job, the shop, and the error page.
