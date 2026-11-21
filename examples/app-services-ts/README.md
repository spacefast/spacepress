# Services authored in TypeScript

[typedpress.config.ts](typedpress.config.ts) configures a contact form, native queued mail, publication search and a server-priced workshop. `typedpress build` emits a private WordPress filter using the existing services module. There is no second service runtime.

Set `APP_SERVICES_RECIPIENT`, `APP_SERVICES_SENDER` and `TP_SERVICES_RATE_SECRET` in the deployed WordPress environment or wp-config constants. `env()` records a variable name; the compiler never reads the value. Mail uses the site's existing WordPress mail integration unless the documented `TP_SERVICES_SMTP_*` override is configured. Checkout requires the documented `TP_SERVICES_STRIPE_SECRET` and `TP_SERVICES_STRIPE_WEBHOOK_SECRET` runtime variables. See [services](../../docs/services.md) for the contracts and deployment limits.

The authored collection key is `articles`; its stored name is `service_posts`. Requests use:

- `POST /wp-json/typedpress/v1/services/forms/contact`, with `Idempotency-Key` and `{ "data": { "email": "visitor@example.test", "message": "Hello there" }, "website": "" }`.
- `GET /wp-json/typedpress/v1/services/search?collection=service_posts&q=workshop`.
- `POST /wp-json/typedpress/v1/services/checkout`, with `Idempotency-Key` and `{ "product": "workshop" }`.

Run the focused authoring owner from the repository root:

```sh
run=$(mktemp -d /tmp/typedpress-ts-services-test.XXXXXXXX)
CARGO_TARGET_DIR="$run/target" \
TP_WP_CACHE="$run/wp-cache" \
TP_WP_PLUGIN_CACHE="$run/plugin-cache" \
TP_SERVICES_TS_EVIDENCE="$run/evidence" \
  cargo test --test services_config -- --nocapture
```

This requires Rust, PHP with SQLite/cURL/ZIP/mbstring, Python 3, Node.js 22.6 or later and `tsc` (or `TSC=/path/to/tsc`). The existing harness downloads pinned WordPress and plugin dependencies into the selected caches. Each test app and WordPress site is disposable. The test removes the site and terminates its loopback SMTP sink; evidence and the chosen caches remain under `$run` for inspection and can then be removed.

The journey typechecks the example and rejected type examples, runs the real compiler, activates its generated plugins on WordPress/SQLite, submits the configured form, runs Action Scheduler, inspects accepted SMTP MIME and queries configured published content. It also checks composition with classic PHP config and checkout's unconfigured response. `result.json` records the effects and cleanup; `mail/*.eml` contains the local message. The PHP-only services suite continues to own deeper runtime behavior.

No provider credentials are used, no Stripe request or charge is made, and the SMTP sink cannot relay to an external mailbox. Local transport acceptance does not prove external delivery or qualify a provider. This journey does not qualify MySQL/MariaDB concurrency.
