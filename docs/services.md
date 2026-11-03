# App services on WordPress

Zero's native services module adds validated contact forms, queued mail, publication search and Stripe-hosted checkout. WordPress remains the authority for users, publication and content permissions. The existing Zero transaction, receipt, outbox and Action Scheduler implementations own atomic writes, request replay and delivery retries.

This is a PHP/WordPress integration. It introduces no TypeScript runtime imports or `zero.config.ts` service syntax. TypeScript pages can call the HTTP endpoints with `fetch`.

## Enable and configure

The runtime registers the services module, its built-in jobs and its system tables automatically. Configure the services your application needs through a trusted WordPress plugin.

A trusted WordPress plugin supplies private configuration through `zero_services_config`. The complete working example is [zero-app-services.php](../examples/app-services/wordpress/zero-app-services.php). It defines:

- Form `contact`, with the existing schema column definitions for email and message validation.
- Searchable `posts` fields `title` and `excerpt`.
- Product `workshop`, priced at 1900 USD minor units on the server.
- An application-owned checkout return URL.

Recipients, senders and provider secrets are environment-variable names in this plugin. Values are resolved at runtime through `Zero\Env`, which also supports wp-config constants. They never enter generated schema, client JavaScript, catalog descriptions or responses.

| Variable | Purpose |
| --- | --- |
| `ZERO_SERVICES_RATE_SECRET` | Random deployment secret used to hash client addresses for rate counters |
| `ZERO_SERVICES_MAIL_TO`, `ZERO_SERVICES_MAIL_FROM` | One valid recipient and sender address each, as referenced by the example form |
| `ZERO_SERVICES_SMTP_HOST` | Optional native SMTP transport; omit to use the existing WordPress mail integration |
| `ZERO_SERVICES_SMTP_PORT` | SMTP port, default 587 |
| `ZERO_SERVICES_SMTP_ENCRYPTION` | PHPMailer encryption, default `tls`; empty only for a local sink |
| `ZERO_SERVICES_SMTP_USER`, `ZERO_SERVICES_SMTP_PASSWORD` | Optional SMTP authentication |
| `ZERO_SERVICES_STRIPE_SECRET` | Stripe API secret, supplied only on the server |
| `ZERO_SERVICES_STRIPE_WEBHOOK_SECRET` | Signing secret for this endpoint's Stripe events |

Keep prices, currency, product names and the return URL in trusted server configuration. Use HTTPS for the deployed site and return URL. Configure a real WP-Cron or WP-CLI cron runner for Action Scheduler on deployed WordPress.

## HTTP contract

Paths below follow `/wp-json/zero/v1`. Successes use `{ "data": ... }`; failures use the existing problem-document envelope. Both POST entry points require an `Idempotency-Key` header of 1–64 bytes. Retry the same intent with the same body and key; use a new key after editing the input.

| Method and path | Input / result |
| --- | --- |
| `POST /services/forms/contact` | `{ "website": "", "data": { "email": "visitor@example.test", "message": "Hello there" } }` → submission id and queued notification receipt |
| `GET /services/submissions/{id}` | Editor-only saved values plus job state, attempt count and completion time |
| `GET /services/search?collection=posts&q=workshop` | At most 20 published, accessible results, with explicit configured fields |
| `POST /services/checkout` | `{ "product": "workshop" }` → opaque status token, status path and `requested` state |
| `GET /services/checkout/{token}` | Current payment state, server price, checkout URL when available and checkout-job status |
| `POST /services/stripe/webhook` | Raw Stripe event body plus `Stripe-Signature`; authenticated receipt and duplicate indicator |

The checkout token is a bearer capability. Keep it in the browser session; do not publish it or attach it to analytics. Its hash is stored on the order. The existing HTTP replay receipt necessarily retains the original response, including this token, in server-only storage for its normal retention window.

## Forms and email

The supported form fields are text, email, integer and boolean. Schema validation rejects unknown fields and invalid values before any writes. Requests are limited to 32 KiB. A filled `website` honeypot is rejected. Fixed fifteen-minute rate windows use durable counters on the app connection: five accepted intents per address/form by default, configurable from 1 to 100. Valid receipt replays do not consume another slot. Stale address counters expire after one day.

Only `REMOTE_ADDR` identifies the client. Forwarded headers are untrusted; configure the web server's trusted-proxy handling if it is behind a proxy. These controls reduce basic automated spam; they are not a CAPTCHA or a moderation service.

The submission and mail job commit together. An aborted transaction removes both, along with the outbox ticket and replay receipt. The outbox schedules Action Scheduler only after commit. The native callable mail handler runs outside a database transaction. WordPress owns MIME and PHPMailer; without an SMTP override, existing WordPress mail plugins remain authoritative. Each send restores the mailer's previous message identity and any transport settings it overrides, including on failure.

Job states distinguish `pending`, `running`, `failed`, `dead` and `done`. A mail job becoming `done` means the configured transport accepted the message. It does not prove inbox placement. Delivery is at least once: a worker crash after SMTP acceptance can cause another attempt. The submission supplies a stable Message-ID, but SMTP offers no universal deduplication guarantee. Submissions and mail job inputs remain private; no public submission-status lookup is provided.

## Search and native content changes

Search uses viewer-bound `db()->findMany`, with an explicit `published` filter and a fixed list of text fields. Existing row and field access rules run before SQL; an unreadable search field is rejected rather than used to infer membership. An editor's draft privileges do not make draft content searchable here.

Results come from current content, without a second index. Editing, unpublishing, republishing or deleting through WordPress takes effect on the next query. Search is bounded lexical matching, not semantic search, fuzzy ranking, an external search provider or a full-text index. It supports publication-enabled Zero collections with text columns.

## Hosted checkout and webhook recovery

Only a product id is accepted from the client. The order snapshots the name, integer minor-unit amount, currency, return URL and absolute expiry. No card fields, arbitrary checkout URLs or client prices are accepted. A job calls the fixed Stripe Checkout endpoint with pinned API version `2024-06-20`, an order-specific Stripe idempotency key and immutable request bytes. It runs after commit and outside the write transaction. Checkout sessions expire after one hour; creation retries stop once the original expiry is less than thirty minutes away. A lost response retries the same Stripe key inside that bounded window.

An intent whose creation window closes becomes `expired`; its job finishes without another provider request. The browser can start a fresh intent immediately. A concurrent signed payment state is preserved.

The returned URL must be HTTPS on `checkout.stripe.com`. The browser follows it; payment details go directly to Stripe. The return page does not mark an order paid. It refreshes the server's signed-event state using the saved browser-session token.

Stripe's raw-body timestamped v1 HMAC is checked within a five-minute tolerance before persistence. Session events must match the saved order id, session identity when known, currency, total amount and payment mode. Event ids and body hashes are stored in a durable payment-event ledger. Replays return the recorded acknowledgement; substitution under the same id is rejected. Event recording and order transitions share a transaction. Invalid events consume no ledger entry.

The lifecycle is `requested → ready → processing → failed/expired → paid`. Failed and expired sessions may still settle on a later authenticated success. `paid` is absorbing: late failure, expiry and unpaid-completion events cannot undo it. A webhook arriving before the checkout worker records the session is supported. The checkout worker never regresses an event-derived state.

The supported subset is one product, quantity one, one-off payment. Currency amount conventions must be checked for the currencies you configure. Subscriptions, tax, shipping, discounts, refunds, disputes, Connect and fulfillment integrations are outside this module. Fulfillment should use the saved paid state and a durable application operation, never the browser return URL.

## Run and verify

See [the runnable example](../examples/app-services/README.md) for local SMTP setup, disposable WordPress and browser acceptance commands. The PHP feature owner is `tests/php/services_test.php`.

Local evidence proves WordPress 7.1.4, SQLite Database Integration 3.1.2, Action Scheduler 4.2.0 and WordPress's bundled PHPMailer 7.1.1. The example and runtime services are first-party code. No additional upstream SDK, plugin source or license notices were copied or removed. The existing WordPress and plugin licenses remain in their original owners.

The local SMTP sink proves the SMTP conversation and stored MIME bytes. Local signed Stripe protocol tests prove this runtime's validation, ledger, transitions and restart behavior. They are not Stripe sandbox acceptance or hosted mailbox delivery. Provider qualification requires designated test credentials and actual provider effects. Neither is claimed by the local suite. MySQL/MariaDB contention is also outside the SQLite evidence.
