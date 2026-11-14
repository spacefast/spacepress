#!/usr/bin/env bash
# One shipped-module owner on the active disposable WordPress stack.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
if [[ ${FIRST_WP_SKIP_BROWSER:-0} == 1 ]]; then
  echo 'browser journey skipped: FIRST_WP_SKIP_BROWSER=1'
  exit 0
fi
browser="$repo/runtime/admin/apps/node_modules/.bin/playwright"
if [[ ! -x "$browser" ]]; then
  echo 'browser journey requires: cd runtime/admin/apps && pnpm install --frozen-lockfile && pnpm exec playwright install chromium' >&2
  exit 1
fi
# Polylang sends the first wp-admin page after its activation to its setup wizard, once; the journey
# opens wp-admin pages and wants the ones it asked for.
"$repo/tests/wp/harness.sh" wp transient delete pll_activation_redirect >/dev/null 2>&1 || true
exec "$browser" test --config "$repo/runtime/admin/apps/wp-journey/playwright.config.ts"
