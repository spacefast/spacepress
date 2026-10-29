# Bundled PHP dependencies

End-user builds need neither Composer nor Strauss. The binary embeds the committed
`runtime/Zero/vendor-prefixed` tree and copies it into both runtime targets, and
`runtime/identity/vendor-prefixed` into the `zero-identity` plugin.

| Root | Package | Locked version | Purpose | Transitive packages |
|---|---|---|---|---|
| runtime | `wp-php-toolkit/markdown` | 0.10.1 | WordPress-maintained Markdown to Gutenberg conversion and front matter parsing for sync | 7 shared toolkit packages |
| runtime | `wp-php-toolkit/merge` | 0.10.1 | Server-side line differ and three-way merge, shared by both targets | 0 additional |
| runtime | `wp-php-toolkit/blockparser` | 0.10.1 | WordPress's own block parser, so sync reads and writes block delimiters the same way on standalone as on WordPress | 0 additional |
| identity | `web-auth/webauthn-lib` | 5.3.9 | Passkeys: CBOR/COSE/attestation parsing is not hand-rollable | 29 (Symfony serializer and friends, cose-lib, cbor-php, pki-framework) |
| identity | `firebase/php-jwt` | 7.1.0 | RS256 signing for the issuer and inbound ID-token verification; one JWT library | 0 |
| identity | `spomky-labs/otphp` | 11.5.0 | TOTP for MFA; small, maintained, proven by the MFA suites | 1 shared (`paragonie/constant_time_encoding`) |

The seven shared packages are `bytestream`, `data-liberation`, `encoding`,
`filesystem`, `html`, `http-client` and `xml`, all locked at 0.10.1. Markdown
also contains its upstream-patched CommonMark, Symfony YAML and Webuni front
matter implementations. Strauss prefixes those nested definitions too.
The generated tree currently occupies about 6.1 MiB before packaging; embedding
omits dependency tests, docs and Markdown files. Its aggregated license file and
original license files ship with the runtime.

All bundled runtime classes, functions and constants use `Zero\\Vendor`, `Zero_Vendor_`
and `ZERO_VENDOR_` prefixes; identity's use `Zero\\Identity\\Vendor`, `Zero_Identity_Vendor_`
and `ZERO_IDENTITY_VENDOR_`. Each bundle has its own Composer loader class and files registry. Composer's autoload-files registry has a separate
Zero key so another plugin's unprefixed library cannot suppress its loading.
The `override_autoload` entries normalize the toolkit's `./` classmaps to `.`
for Strauss while retaining the upstream file/exclusion metadata.

Regenerate after changing a lock with PHP 8.2, Composer 2 and:

```sh
scripts/vendor.sh runtime
tests/php/run.sh vendor
```

`scripts/vendor.sh all` also regenerates the identity root when its Composer
manifest exists. `STRAUSS_PHAR` may point at an existing PHAR; its SHA-256 must
match the pinned Strauss 0.31.1 release. The default downloads it into ignored
`scripts/.tools`. Commit the lock, prefixed tree and `.manifest.json` together.
The manifest records the lock hash and generation toolchain. The drift suite
checks that relationship and executes the real bundled parser and merger while
foreign YAML and WordPress HTML class names are already occupied. The vendor CI
job regenerates the tree on PHP 8.2 with pinned Composer 2.10.3 and checks for
tracked changes and new untracked bundle files.
Generation normalizes the build helper's inferred Composer branch and commit so
the bundle stays identical across checkouts.

Identity's OAuth server and OIDC client are not libraries: the authorization-code grant, PKCE,
refresh rotation and the relying-party transport are ~600 lines in `runtime/identity/src`
(`OAuth`, `Protocol\\AuthCode`, `Providers\\OidcClient`), replacing `league/oauth2-server`,
`nyholm/psr7`, `defuse/php-encryption`, `lcobucci/jwt` and `jumbojett/openid-connect-php`.

The identity screens (`runtime/identity/build/`) are built from `runtime/identity/apps` with
pnpm and esbuild and committed; `build/.manifest.json` records a hash of the sources that the
`vendor` drift suite checks. Rebuild after changing them:

```sh
cd runtime/identity/apps && pnpm install --frozen-lockfile && node build.mjs
```

The Markdown consumer and line merger work without WordPress. The toolkit's
Markdown producer and HTML processor call a few WordPress functions
(`parse_blocks`, `serialize_block`, `esc_*`, `__`). WordPress defines them; on
standalone `runtime/Zero/Sync/wordpress-functions.php` defines them over the
bundled block parser, loaded only when sync converts a body and only when
WordPress is absent.
