# Locales off for now

## Problem

Locales (`locales` in `defineConfig`, `.localized()` fields, Polylang
translations) should not ship to apps for now, but the feature should come back
later without being rewritten.

## Decision

The compiler refuses `locales` with "locales are turned off for now". The code
stays: the runtime, Polylang install, client types and every locale test are
untouched. Only `TYPEDPRESS_LOCALES=1` lets `locales` through. `.cargo/config.toml`
and the CI workflows set it so the suite keeps exercising the feature; a released
binary, `typedpress dev` and the browser playground never see it. The `tests/wp`
lanes that build locale apps outside cargo (`run.sh`, `store-install-run.sh`) export it
themselves; `scripts/check-examples.sh` and `check-generated.sh` unset it, so examples
keep building as users build them. The examples and
the user-facing guide no longer use or mention locales.

Existing sites are not migrated: a site built with `locales` keeps its Polylang
data, and its next build fails until `locales` is removed.

## Bringing it back

Delete the gate in `src/extract.rs` (search `TYPEDPRESS_LOCALES`), its test
`locales_are_turned_off` in `tests/compiler.rs`, `.cargo/config.toml` and the
workflow `env` entries, and restore the `locales` doc comment. The examples and
guide changes can be reverted from the commit that turned locales off.
