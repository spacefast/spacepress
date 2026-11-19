# Community Kitchen

The kitchen sink is a teaching kitchen with workshops, a journal, a handbook, staff tools, and a small WooCommerce shop.

```sh
typedpress dev examples/kitchen-sink
```

Open the URL printed by `typedpress dev`. Sign in with the local development account to reserve a seat, leave a comment, or open the staff tools. The native WooCommerce checkout uses cash on delivery for kitchen pickup.

| Where | What to try |
| --- | --- |
| `/`, `/find` | Paginated workshops, search, and a client component that tracks open registrations |
| `/events/bread-basics` | Synced workshop, live registration status, reservation form, and comments |
| `/journal/feeding-a-starter`, `/handbook` | Native WordPress posts, Markdown sync, and handbook navigation |
| `/visits/saturday`, `/about` | A prerendered route with static params and a Markdown page |
| `/staff`, `/wp-admin/new/screens/schedule` | An editor guard, an admin screen, and the generated API reference |
| `/api/schedule`, `/api/registration` | Public schedule JSON and a signed registration webhook |
| `/shop`, `/cart`, `/checkout` | Woo products, cart, and the native Checkout Block |
| `/wp-login.php`, `/wp-json/mcp/typedpress-kitchen-sink` | An app login component and the app's MCP server |

`tp/schema.ts` declares the kinds, field settings, and private handout bucket. `tp/server.ts` reserves seats, queues confirmation mail and activity, and calls a WordPress Ability. `tp/plugins/kitchen-policy` adds a package hook. Set `KITCHEN_REGISTRATION_SECRET` to enable the signed route. `KITCHEN_WEBHOOK_URL` and `KITCHEN_WEBHOOK_SECRET` configure outgoing events.

Locales are disabled in standard builds. Whole-site static export requires a separate configuration because this app has guarded pages and request-time data.

`cargo test --test kitchen_sink -- --nocapture` checks public value exports, field modifiers, and page features. It builds the app and checks each registered route on WordPress with the theme active.
