# One sign-in page

## Problem

A First site had one account table (`wp_users`) and two sign-in pages:

- **wp-login.php**, used by wp-admin and by a layout's `guard` (`AppRouter` sends a signed-out
  visitor to `wp_login_url()`).
- **First Identity's hosted screens at `/identity`**: email code, password, passkey, MFA and
  Google. They set their own 24-hour session cookie (`zi_session`), which only authenticated
  Identity's REST API and its OpenID Connect issuer.

An account with Identity MFA could not use the first page at all: Identity refused its password
on wp-login.php with "Use the Identity sign-in page". An app could not style either page as part of
its own front end.

The owner's ruling: "WP login should be the main login, and we should be allowed to customize it
… like a not-found thing … a login.tsx … they get the protections for free. We have one page, and
that's WP login, and one system."

## Decision

**wp-login.php is the one sign-in page.**

- **`first/app/login.tsx` renders it.** It is optional, root-only and special, like
  `not-found.tsx`: no URL of its own and no `guard`. With it, wp-login.php's sign-in view renders
  the app's page inside the root layout and its stylesheets. That covers the plain view, a failed
  attempt, `loggedout`, `checkemail`, `reauth` and `registration=disabled`.
  - **How.** The router takes the request on `wp_login_errors`. That is the last thing
    wp-login.php does before it prints its page, so `wp_signon()` has already run.
  - **Without `login.tsx`,** WordPress's own page shows, as before.
- **The form still posts to wp-login.php.** WordPress runs every sign-in, so all of these apply
  unchanged:
  - `authenticate` and its filters;
  - the loginErrors hardening (one message for an unknown user and a wrong password);
  - Identity's attempt limits;
  - Two Factor's second step;
  - `login_form` fields from other plugins.
  `<LoginForm />` from `"first/app"` renders the fields wp-login.php reads (`log`, `pwd`,
  `rememberme`, `redirect_to`, `testcookie`). The page receives `LoginProps`:
  - `errors` and `messages`, as text, after `login_errors` and `login_messages`;
  - `login`, the login to fill in again;
  - `remember`, `redirectTo` and `action`;
  - `lostPasswordUrl`, and `registerUrl` when registration is open.
- **What keeps WordPress's screens.** Lost password, reset, register, logout, `postpass`,
  `confirmaction`, `confirm_admin_email`, Two Factor's `validate_2fa`, the interim sign-in inside
  wp-admin and the Customizer's. Reasons:
  - Each prints its own form with its own hooks, so moving one needs its own building blocks and
    tests.
  - Lost password in particular runs the loginErrors redirect *before* the page. A styled copy
    would have to repeat that ordering exactly, or it would say which accounts exist.
  - Moving them is a later change, one action at a time.
- **A render error never locks people out.** If `login.tsx` throws, WordPress's own page shows and
  the error is logged.

**An account with Identity MFA signs in on wp-login.php, through Two Factor.**

- Identity registers its authenticator (TOTP and recovery codes, `Mfa::verify`) as a Two Factor
  provider, `First\Identity\TwoFactorProvider`. It is enabled for every account that has Identity
  MFA. Two Factor is a platform plugin First pins, so it is there.
- On wp-login.php, after the right password, Identity hands the user to Two Factor instead of
  refusing. Two Factor then:
  - suppresses the auth cookies (`send_auth_cookies` false);
  - asks for the code on `validate_2fa`;
  - sets the cookies only after `Mfa::verify` accepts it: current timestep only, no reuse,
    recovery codes single use, Identity's per-address limit and Two Factor's own back-off.
- **Anywhere else a password alone is still refused** (`identity_mfa_required`): XML-RPC, REST, a
  plugin calling `wp_authenticate`, or a site where Two Factor isn't loaded.
- A wrong password still reads as a wrong password and doesn't reveal the factor.

**`/identity` is no longer a second sign-in page.**

- **A WordPress session counts as an Identity session.** When a browser holds a valid WordPress
  login cookie and no identity session, Identity opens one for that user
  (`Plugin::browserSession`) and sets `zi_session`. The new session:
  - is never fresher than the WordPress sign-in (`verified_at` = the WordPress session's `login`);
  - never outlives it (`expires_at` ≤ its `expiration`).
  So consent, `max_age`, the account screens and Identity's REST work as before.
- **A signed-out browser goes to wp-login.php.** The hosted screens (`/identity`,
  `/identity/account`) and `/identity/authorize` send it to `wp_login_url(<where it was>)`. After
  signing in, WordPress sends it back, and the OIDC flow continues to consent and the callback.
- **`prompt=login` and an expired `max_age`** send the browser to wp-login.php with `reauth=1`,
  which drops the old cookies. The browser's identity session is set aside, so only a sign-in made
  after the request resumes the authorization.
- **Signing out is one action.**
  - Identity's `sign-out` also ends the browser's WordPress session for the same account.
  - Signing out of WordPress ends the identity session.
  - Signing in on wp-login.php as someone else sets the old identity session aside.
  - An application's RP logout with a matching `id_token_hint` ends the WordPress session too.
- **Programmatic clients are unchanged.** Identity's REST sign-in endpoints (`sign-in/password`,
  `email`, `verify`, `mfa`, `passkey/*`) still issue identity sessions for apps that call them, and
  the token, revoke, handoff, userinfo, JWKS and discovery endpoints are as they were.

**Sign-ins without a WordPress password stay reachable from the one page.**

- When wp-login.php signs in for Identity (its `redirect_to` is under `/identity`), the form gets a
  link: "Sign in with an email code, a passkey or another account". It opens the hosted screen
  with `?methods=1`, which still offers email codes, passkeys and Google.
- Those finish with an identity session, not a WordPress login cookie. That is enough for the
  application flow and the account screens, which is what the link is for.
- A guest's upgrade (`handoff`) and a second factor still owed after an external provider
  (`?factor=`) also stay on the hosted screen.

## Not done

- **Passkeys, email codes and Google on the one page itself** (a `<SignInOptions />` that ends with
  a WordPress auth cookie). Shipping it correctly needs three things:
  - a way for an identity sign-in to set the WordPress cookie that keeps MFA in the loop (Two
    Factor's step for those sign-ins);
  - the browser WebAuthn ceremony on a compiled page;
  - tests for each.
  A partial version would be a second way in that skips a factor, so it is left out.
- **Styling lost password, reset and register** (see above).

## Costs

- **A visitor's first request to `/identity` after a WordPress sign-in writes an identity session
  row.** It is one row per browser and expires with the WordPress session.
- **Identity's 24-hour cap still applies** to a session opened from a long "Remember Me"
  WordPress session. The next request after it expires opens a new one from the same WordPress
  session.
- **The hosted screen no longer shows its own password form to a signed-out browser.** A site
  without `login.tsx` sends that browser to WordPress's stock sign-in page.

## Revision after the security review (2026-11-16)

The project is TypedPress now (`tp/app/login.tsx`, `TypedPress\Identity\TwoFactorProvider`). A
review of the first version found ways the WordPress session and the identity session could
disagree. These rules replace the matching bullets above.

- **Only Identity's factor counts for an account with Identity MFA.**
  - Its only Two Factor method is Identity's (`two_factor_enabled_providers_for_user`): no emailed
    code or Two Factor TOTP as a weaker second factor.
  - A WordPress session opens an identity session for such an account only when that session
    records Identity's factor (`two-factor-provider` is `TypedPress_Identity_TwoFactorProvider`,
    with `two-factor-login`). The provider's Two Factor key has no backslashes, because WordPress
    unslashes the user meta and session data it is stored in. A session made any other way gets no identity session: another Two
    Factor method, or a plugin that calls `wp_set_auth_cookie` without `wp_login` (User Switching
    and the like).
- **The identity session is tied to the WordPress session it came from.**
  - It stores the WordPress session's verifier (`sessions.wp_token`, the SHA-256 WordPress itself
    stores; schema version 4).
  - When that WordPress session ends, the identity session and the application tokens minted from
    it are revoked on their next use. That covers sign-out, "log out everywhere else"
    (`destroy_others`), an administrator ending sessions, and expiry. `Sessions::find`,
    `OAuth::live` and access-token checks all apply this.
  - Revoking the identity session ends the WordPress session.
  - A browser that loses its identity cookie gets the same row back with a new secret, so there is
    no new row per request.
- **WordPress's sign-in wins.** An identity cookie for a different user than the browser's
  WordPress session (a planted or stale cookie, a guest handoff) is dropped, and the identity
  session comes from the WordPress one.
- **RP logout.**
  - With an unexpired `id_token_hint` naming the browser's WordPress user, `/identity/logout` ends
    both sessions.
  - Without one, or with an expired hint, it shows a confirmation form instead (POST, a
    WordPress nonce, this site's Origin). A link alone never signs anyone out of the site.
- **The sign-in page and plugins.**
  - On `login.tsx`'s page, `login_head` and `login_footer` fire from `wp_head` and `wp_footer`.
    Core's own callbacks on them are left out, since the document prints those already.
  - The `login_message` notice reaches the page with WordPress's messages, so captcha and anti-bot
    plugins work.
  - If the app's boot or Identity's storage fails, WordPress's own page shows.
- **`<LoginForm />` elsewhere.**
  - Its form carries no `testcookie`. Only wp-login.php's own page sets the test cookie, so a
    first-time visitor would otherwise fail the first attempt.
  - A page whose form prints `login_form` output (a captcha challenge, a nonce) is
    `private, no-store`.
- **Subdirectory installs.** The way back to `/identity` is built from the request's own path, so
  the subdirectory appears once.

**Left as is.** One low-severity finding of that review (L4) is deliberately not changed here.

## Second revision (2026-11-16)

A re-review found these, now fixed:

- **RP logout checks before it ends anything.** `OAuth::logoutRequest` validates the hint and
  `post_logout_redirect_uri` and revokes nothing; `OAuth::endLogout` revokes the hint's session.
  `/identity/logout` calls the second only when one of these holds:
  - the hint is unexpired and names the browser's WordPress user;
  - the user confirmed on the form;
  - the browser has no WordPress session to end.
  Before this, an expired hint on a GET (an image on another site) revoked the identity session,
  and through it the WordPress session.
- **Refresh follows the WordPress session, not the 24-hour cookie.** A family started through
  wp-login.php refreshes while its WordPress session is alive, as a family from Identity's own
  sign-in lives until revoked. The identity session's 24 hours bound only the browser cookie; after
  them a browser still signed in to WordPress gets a new identity session.
- **Parallel first requests.** Reopening a bridged session gives the browser a new secret. The
  previous one stays valid for 60 seconds (`previous_secret_hash`, `previous_until`), so a cookie
  set by a request a moment earlier keeps working.
- **Turning MFA on** ends the user's other WordPress sessions and keeps this browser's
  (`destroy_others`). Ending all of them would end the identity session it came from and sign the
  user out mid-setup.
- **Identity's REST API** applies the same rule as the hosted screens: an identity cookie for a
  different user than the WordPress session gives way to the WordPress sign-in.
- **A managed build before `Loader::initialize`.** A host can serve requests from a mounted build
  before its initialize has brought identity storage to schema 4. Until the stored version says 4,
  nothing reads or writes the new session columns and no WordPress sign-in opens an identity
  session (`Schema::linksWordPressSessions`). A session the bridge couldn't tie to its WordPress
  session would otherwise outlive it.

## Third revision (2026-11-16)

- **A logout nobody here asked for ends no WordPress sign-in.** `/identity/logout` without a
  WordPress session in the request (an application's own client, a cookieless HTTP call, a
  cross-site image that drops this site's Lax cookies) is neither named nor confirmed:
  - an expired hint ends nothing;
  - a current hint ends only the identity session it names (`Sessions::revoke(..., false)`),
    never the WordPress session that identity session came from.
- **Identity's REST API opens an identity session from the WordPress cookie only for the site's
  own pages:** an `Origin` that is the site's, or `Sec-Fetch-Site: same-origin`. A registered
  application origin (CORS with credentials, a same-site subdomain), or a request that says
  neither, needs the identity cookie itself. Otherwise a WordPress sign-in alone would give that
  origin the account's CSRF token, and with it account writes.
- **Before schema 4, no redirect loop.** On a site whose identity storage isn't yet at schema 4 (a
  managed build before its initialize), a browser signed in to WordPress gets a 503 with
  `Retry-After: 30` from `/identity` and `/identity/authorize`, instead of going round through
  wp-login.php and minting a WordPress session each time. A signed-out browser is still sent to
  sign in.

