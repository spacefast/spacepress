# First Identity: security and operations

## Account model

The durable account identifier is `wp_users.ID`. The plugin stores normalized verified emails, provider identities, sessions, challenges and protocol records in indexed InnoDB tables. Emails use a binary unique index after ASCII lowercase/trim normalization. Internationalized email addresses are currently rejected; dots and plus tags are not rewritten. An account has one primary-email pointer. The primary address cannot be removed until another verified address becomes primary.

Existing WordPress `user_email` is a legacy recovery route. Successful email-code recovery of that address attaches it to its existing WordPress user, and duplicate legacy addresses require administrator resolution. Password checks use WordPress's password verifier. Existing WordPress roles and authored content remain attached to the same ID when the primary email changes.

Password sign-in verifies one fixed hash for every algorithm/cost profile present on the site, substituting the account's own hash only in its matching profile. Missing accounts perform the same schedule. Stored verification hashes encode independent random passwords; user credential hashes are never retained. The current-algorithm dummy is generated once; existing MD5, phpass, imported crypt and PHP password hashes retain their WordPress verification semantics. Profiles are seeded from existing users and recorded on WordPress password writes, and remain after upgrades. Sites with mixed profiles spend more work on every sign-in; this avoids revealing which account still uses a cheaper hash. Generic errors and sign-in rate limits still apply.

Sensitive credential mutations lock account then initiating session and recheck account state, session ownership, expiry, revocation and five-minute reverification. Revocation uses the same lock order. Nested operations use savepoints. One-use challenges expire in five minutes and permit at most five attempts; invitation secrets expire in seven days. Challenge failures are committed independently before credential transactions so failed-attempt counts are not rolled back.

Guests (`first_guest`, created by the First runtime) are ordinary WordPress users without an email. Verifying an email while signed in as a guest attaches it to that user; an address owned by another account never merges into a guest. Passwords, email codes, provider sign-in and passkeys all enter the same MFA gate before creating an identity session. On wp-login.php an MFA-enabled account's right password leads to Two Factor's second step, which checks Identity's factor (`First\Identity\TwoFactorProvider`) before any cookie is set; every other native password sign-in (XML-RPC, REST, a plugin calling `wp_authenticate`, a site without Two Factor) is denied for it. Authenticator TOTP accepts only the current timestep; reuse is rejected. Recovery codes are high-entropy, hashed and single-use. A primary verified recovery address is required before removing provider/passkey credentials.

## Sessions, permissions and logout

| Credential/check                | Bound                                                   |
| ------------------------------- | ------------------------------------------------------- |
| Identity browser session        | 24 hours, live database check on each request           |
| Sensitive-action verification   | 5 minutes                                               |
| App authorization code          | 60 seconds, single use, exact callback/client + S256    |
| App access/ID tokens            | 5 minutes                                               |
| App refresh tokens              | 30 days, rotated on every use, reuse revokes the family |
| Bearer on the REST API          | Live check per request (jti, session, account, app)     |
| Offline JWT verification        | May remain valid for its remaining five-minute lifetime |
| Old signing keys after rotation | 10-minute verification overlap                          |

WordPress REST requests with `Authorization: Bearer` run the same live checks as UserInfo on every request, so revocation and suspension apply at once. An access token carries no WordPress capabilities of its own: the request runs as the WordPress user, with that user's role. Offline JWT validation elsewhere is not suitable for privileged operations requiring immediate revocation.

An application sign-in is one refresh family. It lives until it is revoked (`/identity/revoke`, RP logout, global revocation, password change, suspension) or its refresh token goes unused for 30 days. The identity session's 24-hour expiry bounds the hosted screens, not the families it started. Refresh tokens and authorization codes are stored as SHA-256 digests. A rotated refresh token is kept with `used_at`/`replaced_by`, so presenting it again is detected as theft and ends the family.

Identity session secrets contain 256 random bits and are stored as domain-separated SHA-256 digests. They do not depend on WordPress salts. WordPress salts protect challenges and encrypted secrets (signing keys, MFA secrets, webhook secrets): **rotating the `SECURE_AUTH` salt makes them unreadable**. Back up salts with the database; fixing this with a sealed root key of the plugin's own is a follow-up.

## Password verification budgets

Identity password profiles have operational ceilings. They apply before dummy
generation and in both verification schedules; older stored profiles above the
ceilings are ignored. Above-budget credentials receive the generic sign-in
refusal and require a password reset. They cannot increase other users' work.

| Encoding | Maximum accepted cost | Basis |
| --- | --- | --- |
| Plain bcrypt and WordPress `$wp$2y$` | cost 15 | PHP defaults are 10 on PHP 8.2 and 12 since PHP 8.4. WordPress 6.8+ uses PHP's bcrypt default with SHA-384 pre-hashing and the `$wp` prefix. The ceiling allows eight times the work of cost 12. |
| Portable phpass `$P$` | encoded exponent 16 (65,536 iterations) | WordPress's `PasswordHash(8, true)` emits exponent 13 (8,192 iterations); the ceiling allows eight times that work. |
| SHA-256/SHA-512 crypt | 1,000,000 rounds | The crypt default is 5,000 rounds; this permits imported configurations up to 200 times that default. |
| PHP Argon2i/Argon2id | memory 131,072 KiB (128 MiB), time 8, parallelism 2 | Each parameter is at most twice PHP's defaults: 65,536 KiB, time 4, parallelism 1. WordPress uses these defaults when configured for Argon. |

Plain MD5 and MD5-crypt have no configurable work parameter. All formats must
also pass encoding validation. Default-cost MD5, phpass and real WordPress 7.1
`wp_hash_password()` output remain supported, including `$wp$2y$` verification
with SHA-384 pre-hashing. Custom password settings must stay within these limits.

Supported profiles remain after their last user upgrades or is deleted. This
keeps the shared verification schedule stable without a second user-table scan
or profile reference counts. The ceilings bound each profile, not total sign-in
latency: heterogeneous sites still pay for each distinct supported profile.
Inventory runs and raw-import registration cannot add an over-budget profile.

## Password attempt limits

Password attempts are limited to ten in five minutes per client address, and ten in five minutes per login, whichever fills first. Once a counter is full, every attempt is refused with `rate_limited` ("Too many attempts. Try again later.", status 429) until the five-minute window ends. A window starts at the first counted attempt and stays open for five minutes, whatever comes in between; the next attempt after that starts a new one. Windows don't follow the clock, so there is no moment at which every counter empties. The limit is ten per window, not ten in every span of five minutes: one attempt, then nine as its window ends and ten as the next begins, is nineteen close together, after which ten per five minutes holds again. Every limit Identity applies (email codes, passkey and token requests, second-factor and re-verification attempts, sensitive operations, added emails, invitations) counts this way. This holds on both ways a password reaches the site, and they differ in what they count:

- Identity's own sign-in (`sign-in/password`) counts every attempt, before the password is checked.
- WordPress's own sign-in (`wp-login.php`, XML-RPC where a site turns it on, any plugin that calls `wp_authenticate`) counts failed attempts, as WordPress reports them (`wp_login_failed`). A sign-in that succeeds counts nothing, so an office behind one address, or a person who signs in often, is never limited by it. With a full counter the refusal replaces the password check's answer, so a limited attempt gets the same answer whether the password was right.

The per-login counter is keyed on the login as typed, without letter case; an email address and a username for the same account are separate counters, and both share the per-address one. A form posted with no login or no password isn't an attempt, and Identity's own refusals (a second factor required, an unavailable account, a limit already reached) aren't counted as wrong guesses.

An application password that authenticates a request is never counted: REST checks it outside WordPress's sign-in, and one that signs in through `wp_authenticate` (XML-RPC, where on) succeeds without counting. A wrong one sent through `wp_authenticate` is a failed attempt like any other. The two paths keep separate counters: ten attempts on `wp-login.php` and ten on `sign-in/password` are both allowed.

WordPress's sign-in checks the counters before the password and counts a failure after it, so attempts already in flight when a counter fills are still checked: a burst sent at once can get more than ten password checks before the refusals start. Identity's own sign-in counts first and has no such gap.

The client address is `REMOTE_ADDR`. Behind a proxy or CDN the host must set it to the visitor's address, as WordPress itself expects; otherwise every visitor shares one per-address counter and the per-login limit is the one that protects accounts. When Identity's storage can't read the counters, sign-in is refused, as its other gates do. Anyone can fill a login's counter, so an attacker who knows a login can keep its owner from signing in with a password for as long as they keep trying; passkeys, email codes and existing sessions are not affected.

## Browser and protocol boundaries

Cookie-authenticated writes require the canonical identity Origin or a registered application origin (`applications.origins`, an exact `scheme://host[:port]`). Other origins fail; WordPress's reflected credentialed CORS headers are replaced in this REST namespace by headers for registered origins only. The token and revoke endpoints answer CORS for registered origins without credentials. Sensitive writes use session CSRF tokens. Consent checks Origin and CSRF. `prompt=login`/`max_age` require a new browser sign-in before consent; silent `prompt=none` is not supported.

Incoming OIDC requires provider-pinned algorithms, validated JWKS keys, exact issuer/audience, nonce and time checks. Provider identities use immutable issuer + subject. UserInfo and ID-token subjects must agree. Code, PKCE, state, browser-bound challenge and replay checks are independent.

Deploy behind HTTPS with the correct trusted proxy configuration. Exclude identity HTML/API from shared caches. The development HTTP override requires both `FIRST_IDENTITY_DEV_HTTP=true` and WordPress's `local` environment; do not enable it on public deployments.

## Maintenance and diagnostics

`wp first identity maintenance` sends at most 30 due webhook deliveries per run. A delivery gets a two-minute processing lease, up to eight attempts and exponential retry delays. Delivery is at least once: consumers deduplicate by `First-Event-Id`. Requests do not follow redirects and WordPress's safe HTTP client rejects private-network destinations.

The signature header is `First-Signature: t=<unix>,v1=<hex HMAC-SHA256>`. Verify HMAC over the exact bytes `<timestamp>.<body>`, use constant-time comparison, and reject stale timestamps such as those older than five minutes. Store the signing secret securely. **Identity → Authentication** shows recent status/attempts; it displays a new secret only once. CLI equivalents are `wp first identity webhook-add <https-url>`, `webhooks`, and `webhook-remove <id>`.

Use a real cron scheduler every minute for reliable retries; the fallback WordPress event is hourly and depends on traffic. Monitor `email.accepted`/`email.failed`, `provider.rejected`, account/session events and webhook HTTP statuses. Email acceptance indicates `wp_mail` transport acceptance only. SMTP delivery, bounce handling and inbox acceptance remain transport responsibilities. Authentication rate limits are stored in the database and use both network and account buckets.

Rotate signing keys with `wp first identity rotate-keys`. Back up the database and WordPress salts together. Changing secure-auth salts makes stored encrypted secrets unreadable and requires explicit operational recovery. Never log codes, cookies, tokens, private keys or client secrets.

## Privacy and lifecycle

Users export their profile, connections, session metadata, organization memberships, passkey metadata and events. Exports omit credential secrets. Deletion requests immediately suspend the local account. An administrator completes erasure from People or `wp first identity erase <id>`. Sole organization owners must transfer ownership, and WordPress administrators must transfer administration first. Erasure removes identity credentials and metadata, anonymizes the WordPress account, removes roles and preserves authored content under the retained numeric author ID. It is idempotent. WordPress privacy exporter/eraser callbacks are registered.

Uninstall preserves all data. Backups, external webhook recipients and other plugins' metadata have separate retention policies. V1 uses English UI copy; full localization and enterprise federation/provisioning are not claimed.

The deletion request checks sole-owner status before suspension, so an owner can still sign in and transfer ownership. The erasure transaction repeats the ownership check to handle changes after the request.
