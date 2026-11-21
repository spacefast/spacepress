# Everyday app services

A working WordPress page with a contact form, publication search and a hosted-checkout status surface. It uses the native services runtime, not an in-memory example server.

From the repository root, open a loopback SMTP sink in one terminal:

```sh
python3 examples/app-services/smtp-sink.py --directory /tmp/typedpress-framework-services-demo-mail
```

It prints its dynamically allocated port. In a second terminal, set that port and start the site:

```sh
export TP_SERVICES_RATE_SECRET="$(openssl rand -hex 32)"
export TP_SERVICES_MAIL_TO=inbox@example.test
export TP_SERVICES_MAIL_FROM=sender@example.test
export TP_SERVICES_SMTP_HOST=127.0.0.1
export TP_SERVICES_SMTP_PORT=THE_PRINTED_PORT
export TP_SERVICES_SMTP_ENCRYPTION=
php -d memory_limit=512M examples/app-services/run.php
```

Open the printed `Example:` URL. Search finds the seeded published workshop article. Send a message to save a validated submission. The example prints its owned site directory; process due mail jobs with:

```sh
php -d memory_limit=512M examples/app-services/jobs.php /tmp/typedpress-wp-services-example-THE_PRINTED_SUFFIX
```

The sink writes the actual MIME message as an `.eml` file. This disposable harness disables WP-Cron, so the command above invokes WordPress's existing Action Scheduler runner. On a deployed WordPress site, use its normal cron runner. Ctrl-C stops and removes this example's site and HTTP process. Stop the SMTP sink with Ctrl-C; its saved messages remain in the directory you chose.

Checkout reports that the service is unconfigured until server-side Stripe credentials are set. For designated Stripe test credentials only, export `TP_SERVICES_STRIPE_SECRET` and `TP_SERVICES_STRIPE_WEBHOOK_SECRET` before starting the site. Configure the actual Stripe sandbox to send signed session events to the printed site's `/wp-json/typedpress/v1/services/stripe/webhook` through your approved test forwarding setup. Click **Open checkout**, run the jobs command, then **Refresh status**. The hosted link appears after Stripe creates the session. Complete only a Stripe-hosted test flow; this app never receives card data. Refreshing after the authenticated provider event shows the saved payment state.

The standard TypedPress runtime includes the services module. `fixture.php` packages that runtime with the example's schema in an owned disposable WordPress site. See [services.md](../../docs/services.md) to configure services in your own application.

## Acceptance

```sh
TP_SERVICES_EVIDENCE=/tmp/typedpress-framework-services-php \
  php -d zend.assertions=1 -d memory_limit=512M tests/php/services_test.php
```

Use `TP_WP_CACHE` to select a private cache if other workers are running. The existing WordPress test harness downloads pinned dependencies on the first run. No Node install is needed for PHP acceptance.

For a browser run, point to an existing Playwright ESM installation, with its Chromium already installed:

```sh
TP_SERVICES_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs \
TP_SERVICES_EVIDENCE=/tmp/typedpress-framework-services-browser \
  node examples/app-services/browser.test.mjs
```

The browser submits the form through REST, searches real published content, runs the existing Action Scheduler worker and verifies the resulting SMTP message. It also verifies the unconfigured checkout state. Screenshots, result JSON, MIME bytes and cleanup records go in the chosen evidence directory. Each process and WordPress site is owned and cleaned by that run.

Local evidence does not qualify Stripe's API, signed event delivery from Stripe, external mailbox delivery or MySQL concurrency. The local payment tests use generated signing material solely for protocol/state-machine tests and never call Stripe with invented credentials. There are no live charges or messages to external recipients.
