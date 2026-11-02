#!/usr/bin/env bash
# One shipped-module owner on the active disposable WordPress stack.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
if [[ ${ZERO_WP_SKIP_BROWSER:-0} == 1 ]]; then
  echo 'browser journey skipped: ZERO_WP_SKIP_BROWSER=1'
  exit 0
fi
browser="$repo/runtime/admin/apps/node_modules/.bin/playwright"
if [[ ! -x "$browser" ]]; then
  echo 'browser journey requires: cd runtime/admin/apps && pnpm install --frozen-lockfile && pnpm exec playwright install chromium' >&2
  exit 1
fi
exec "$browser" test --config "$repo/runtime/admin/apps/wp-journey/playwright.config.ts"
