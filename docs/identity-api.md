# Zero Identity API

The REST base is `https://site.example/wp-json/zero-identity/v1/`. Success responses are `{ "data": ... }`; failures are `{ "error": { "code": "...", "message": "..." } }` with an appropriate HTTP status. Responses are not cacheable. Codes, IDs and passwords are strings in JSON; timestamps are Unix seconds.

The hosted screens at `/identity` are this API's own client. A frontend app doesn't call it
directly: it signs users in through the OpenID Connect issuer below (Zero's typed client does
that for you). Registered application origins (`applications.origins`) may call this API and
the token endpoints cross-origin; every other origin is refused.

## Sign-in

| Method and path                | Body                         | Result                         |
| ------------------------------ | ---------------------------- | ------------------------------ |
| GET `config`                   | —                            | Providers and issuer           |
| POST `sign-in/email`           | `email`                      | `challenge_id`                 |
| POST `sign-in/verify`          | `challenge_id`, `code`       | Login result                   |
| POST `sign-in/password`        | `login`, `password`          | Login result                   |
| POST `sign-in/mfa`             | `challenge_id`, `code`       | Signed in                      |
| POST `sign-in/passkey/options` | `{}`                         | Challenge and WebAuthn options |
| POST `sign-in/passkey/verify`  | `challenge_id`, `credential` | Login result                   |

A login result is `{kind:"signed_in"}` or `{kind:"mfa_required",challenge_id}`. A primary factor never creates a session when MFA is required. The MFA challenge also requires the browser binding cookie. External providers start through `/identity/provider/start?provider=google` and return through their registered callbacks. Google is built in (`ZERO_IDENTITY_GOOGLE_CLIENT_ID`/`_SECRET`); add others with the `zero_identity_providers` filter (`issuer`, `client_id`, `secret`, optional `discovery`).

**Guests.** When the browser holds a session for a `zero_guest` user, `sign-in/verify` attaches the verified address to *that* user and makes it a `subscriber`: same user id, `zero_identity_guest_upgraded` fires. If the address already belongs to someone, the browser signs into that account and the guest stays as is (no merge). `GET account` reports `account.guest`.

## Account

| Method and path            | Body                             | Notes                                   |
| -------------------------- | -------------------------------- | --------------------------------------- |
| GET `account`              | —                                | Account (with `guest`), session, CSRF and MFA state |
| PATCH `account`            | `name`                           | Update display name                     |
| POST `emails`              | `email`                          | Send verification code                  |
| POST `emails/verify`       | `challenge_id`, `code`           | Claim verified address                  |
| POST `emails/primary`      | `id`                             | Select an owned address                 |
| POST `emails/remove`       | `id`                             | Primary removal is refused              |
| POST `providers/link`      | `provider`                       | Returns external authorization URL      |
| POST `providers/remove`    | `id`                             | Requires a verified recovery email      |
| GET `sessions`             | —                                | Active session metadata                 |
| POST `sessions/revoke`     | `id`                             | Revoke one owned session                |
| POST `sessions/revoke-all` | `{}`                             | Global session revocation               |
| POST `sign-out`            | `{}`                             | End current identity session            |
| POST `reverify/email`      | `{}`                             | Code to primary address                 |
| POST `reverify/verify`     | `challenge_id`, `code`, `factor` | MFA factor required when enabled        |
| POST `reverify`            | `password`, `code`               | Password + MFA alternative              |
| POST `password`            | `password`                       | Minimum 12 characters; revokes sessions |
| POST `mfa/setup`           | `{}`                             | Secret and provisioning URI             |
| POST `mfa/enable`          | `code`                           | One-time display of recovery codes      |
| POST `mfa/recovery-codes`  | `code`                           | Replace recovery codes                  |
| POST `mfa/remove`          | `code`                           | Requires a factor; revokes sessions     |
| GET `passkeys`             | —                                | Credential metadata                     |
| POST `passkeys/options`    | `{}`                             | Registration options                    |
| POST `passkeys/register`   | `challenge_id`, `credential`     | Register verified WebAuthn response     |
| POST `passkeys/remove`     | `id`                             | Requires a recovery email               |
| POST `account/export`      | `{}`                             | Personal data without secrets           |
| POST `account/delete`      | `confirmation:"DELETE"`          | Suspend and request erasure             |

All account writes need `X-Identity-CSRF`. Sensitive routes require a live session reverified in the past five minutes, including credential changes, organization management and privacy exports.

## Organizations

GET `organizations` lists the caller's memberships. POST `organizations` accepts `name` and `idempotency_key`. Reusing the same key/name returns the same organization; changing the payload under that key fails. POST `organizations/invite` accepts `organization_id` and `email`; the inviter must be an owner/admin. POST `organizations/accept` takes the emailed `invitation` token and requires ownership of its verified address. GET `organizations/members?organization_id=...` lists members. POST `organizations/role` takes `organization_id`, `user_id`, and `role` (`owner`, `admin`, `member`); only an owner may change roles, and the last owner is protected.

## Administration

Routes below `admin/` require a native WordPress administrator, `manage_options`, a REST nonce in `X-WP-Nonce`, and the site's exact Origin on writes (registered application origins are refused here). Identity sessions do not grant WordPress administration.

Read routes: `people`, `organizations`, `applications`, `sessions`, `authentication`, `security-events`, `webhooks`. Account/session/event listings currently return up to 200 records; this is an initial administration limit, not unbounded paging.

Mutation routes: `people/suspend`, `people/erase`, `sessions/revoke`, `keys/rotate`, `webhooks`, `webhooks/remove`, and `applications`. Application registration takes `name`, `redirect_uri`, `origin` and `idempotency_key`. It permits no wildcards, fragments or callback-origin mismatches. Webhook registration returns its signing secret once.

CLI: `wp zero-identity account <id>`, `suspend`, `restore`, `revoke`, `erase`, `rotate-keys`, `webhook-add`, `webhook-remove`, `webhooks`, `maintenance`, and `wp zero-identity app add --name=<n> --redirect=<uri> --origin=<origin> [--id=<app_id>]` (an `--id` rerun with the same values returns the same app). The Abilities API gets `zero-identity/account`, a capability-checked account read.

Webhook deliveries carry `Zero-Event-Id` and `Zero-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + body)>`.

## OpenID Connect issuer

Discovery is `/identity/.well-known/openid-configuration` (also at the root `/.well-known/openid-configuration`). Applications are public clients: PKCE S256 is required, `token_endpoint_auth_methods_supported` is `["none"]`, and the `openid` scope, `state` and `nonce` are required.

| Endpoint | Method | What it does |
| --- | --- | --- |
| `/identity/authorize` | GET, POST | Consent for a live identity session; redirects to the exact registered callback with `code` + `state` |
| `/identity/token` | POST (form) | `grant_type=authorization_code` (`code`, `redirect_uri`, `client_id`, `code_verifier`) or `grant_type=refresh_token` (`refresh_token`, `client_id`) |
| `/identity/revoke` | POST (form) | RFC 7009: `token`, `client_id`. A refresh token revokes its family, an access token its `jti`; unknown tokens succeed |
| `/identity/logout` | GET, POST | RP-initiated: `id_token_hint`, `post_logout_redirect_uri` (must share an origin with a registered callback), `state` |
| `/identity/userinfo` | GET | `Authorization: Bearer <access token>` |
| `/identity/jwks` | GET | RS256 public keys; rotated keys stay valid ten minutes |

A token response is `{ access_token, token_type: "Bearer", expires_in: 300, refresh_token, scope, id_token? }`. The access token is an RS256 JWT (`iss`, `aud` = client id, `sub` = WordPress user id, `jti`, `sid`, `exp`). The refresh token is `zr_` + 43 base64url characters, valid 30 days and **rotated on every use**: presenting one that was already used revokes its whole family and answers `400 invalid_grant`. Authorization codes are single use and live 60 seconds; a replayed code also revokes the tokens it minted. Token errors are RFC 6749 bodies `{ error, error_description }`.

**Bearer on the REST API.** `Authorization: Bearer <access token>` authenticates any WordPress REST request (a `determine_current_user` filter after core's cookie and application-password resolvers). It applies the UserInfo checks: signature, issuer, expiry, unrevoked `jti` and session, active account, enabled application. A token that fails answers `401 invalid_token`; a suspended or deleted account answers `403 suspended`.

**Guest handoff.** A guest's app holds Bearer tokens but no identity cookie. `POST /identity/handoff` with the guest's Bearer token returns `{ handoff }` (single use, 60 s). Sending the browser to `/identity/authorize?…&handoff=<handoff>` signs it in as that guest and opens the hosted screen to add an email; consent then returns to the app as usual. A handoff is bound to the guest's session and token family: revoking either first voids it. Upgrading a guest revokes all of its earlier sessions and token families, so nobody who held the guest's credentials keeps the verified account; the browser that verified gets fresh ones through consent.

**Shared connection.** Identity runs on WordPress's `$wpdb` connection. A host that already owns a transaction on it (the Zero runtime) answers `true` from the `zero_identity_outer_transaction` filter; identity then joins with savepoints instead of committing the host's work.

PHP API for the Zero runtime: `Accounts::issueForUser(int $wpUserId, string $clientId)` mints a session and token pair without a browser (only after `zero_runtime_loaded`), and `Accounts::status(int $wpUserId)` returns `active`, `suspended`, `deletion_requested`, `deleted` or `none`.

## Errors and retries

Common codes include `unauthenticated` (401), `invalid_credentials` (401), `invalid_factor` (401), `invalid_challenge` (400), `reverification_required` (403), `invalid_token` (401), `suspended` (403), `invalid_origin`/`invalid_csrf` (403), `email_in_use`/`ownership_conflict`/`link_required`/`provider_in_use` (409), `last_owner` (409), `rate_limited` (429), and `email_delivery_failed` (503). Validation failures do not expose tokens or upstream secrets.

Retry read requests freely. Use stable idempotency keys for creation retries. Primary selection, removals, revocation and erasure are safe to repeat. Verification challenges and authorization codes are one-use: after an ambiguous successful response, reload account/session state instead of replaying the credential. Sending another email or invitation intentionally creates another expiring challenge.
