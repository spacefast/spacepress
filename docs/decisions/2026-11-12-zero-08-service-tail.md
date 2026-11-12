# Zero 0.8 features that need an owner ruling before they convert

`first migrate app --from zero-0.8` refuses each feature below with a located diagnostic, and
each refusal names its fix. None of them can be converted without new First product surface,
so each waits on an owner ruling. Counts are live 0.8 capsules on production (read replica,
2026-11-12; `/tmp/first-finish-20261111/census-08-features.md` has the filters). Client-library
counts come from the 404 versions whose `client.js` bytes are stored.

| Feature | Spaces | Refused with | Recommendation |
|---|---:|---|---|
| `ctx.auth.userId` without Space Users | 350 | `Z08_CTX_AUTH_USERS` | Decide how Sign in with Spacefast signs visitors in to a First Space, and whether 0.8 `guest:<id>` rows get guest users. With Space Users it already converts (`--users`). |
| `ctx.auth` profile fields without Space Users | 110 | `Z08_CTX_AUTH_PROFILE` | Same decision as above: what a First user carries for `email`, `picture`, `provider`. With Space Users they convert. |
| `@spacefast/zero/kit` in a client app | 133 of 404 | `Z08_CLIENT_KIT` | Vendor one frozen compat build at `public/first/kit.js`, beside the vendored Preact, plus a frozen `kit.css`. Refuse `Payment` and `ConnectorGate` by name. No kit importer in the 373 readable `client.js` imports either one. The owner must rule that a vendored 0.8 kit counts as compat runtime, not "client npm bundling". |
| `ctx.email.send` delivery on Spacefast | 56 | converts to `mail.send` | Converts already. Spacefast must connect `first_mail_transport` to the Space's sender (monorepo #5063). |
| `ctx.spam` | 21 | `Z08_CTX_SERVICE` | First's spam checks use the Akismet a site has through Jetpack, only while it has a key. Recommend mapping `ctx.spam.check` to that Akismet with a located `review` entry, and answering `{ spam: false, discard: false }` with a refusal-free warning when there is no key. Needs a ruling on whether "no key, no check" is acceptable for migrated apps. |
| `ImageResponse` | 19 | `Z08_IMAGE_RESPONSE` | First renders no images server-side. Recommend keeping the refusal, with the fix "render the image ahead of time or from a client page", until a ruling adds server image rendering. |
| Connectors (`ctx.connectors`, capsule roles) | 6 to 12 | `Z08_CTX_SERVICE`, `Z08_OMITTED_CONNECTORS` | Needs a connector broker in PHP (Connectors v2). Keep refused. |
| `ctx.jwt.sign` | 3 | `Z08_CTX_SERVICE` | 0.8 signs Ed25519 `at+jwt` with a seed in a secret variable. First's `node:crypto` has hashes and HMAC only. Recommend adding Ed25519 signing to First's `node:crypto` (PHP `sodium_crypto_sign_detached` is always available on PHP 8.2), then mapping `ctx.jwt.sign` onto it. Needs a ruling because it widens the crypto surface. |
| Markdown or HTML pages | 23 | `Z08_PAGE_DOCUMENT` | Belongs with First pages (`app-pages` lane). |

Converted in this push, with no ruling needed: client apps without pages in wasm (#268), the
`zero.css` stylesheet as an input (#276), writing GET endpoints that never read the visitor
(#274), `sf.jsonc` crons at a converted GET path (#278), profile fields under Space Users (#275),
and `ctx.gravatar` (#279).

Design calls for the kit and crons came from Fable 5.2 (claude-fable-5-2), medium effort. The
rest are the lane's recommendations, written by Opus 5.5.
