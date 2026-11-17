#!/usr/bin/env bash
# Own one new local stack per run. Keep its database, documents, audit trail and receipt afterwards.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
browser="$repo/runtime/admin/apps/node_modules/.bin/playwright"
[[ -x "$browser" ]] || { echo 'Install runtime/admin/apps dependencies and Playwright Chromium first.' >&2; exit 1; }
if [[ ${TP_COEDITING_EXISTING:-0} != 1 ]]; then
  run_root="$(mktemp -d "${TMPDIR:-/tmp}/typedpress-coediting.XXXXXXXX")"
  chmod 700 "$run_root"
  export TP_WP_PROJECT="${TP_WP_PROJECT:-typedpress-coediting-$(basename "$run_root" | tr '[:upper:]' '[:lower:]' | tr '.' '-')}"
  export TP_WP_PORT="${TP_WP_PORT:-$(python3 - <<'PORT'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PORT
)}"
  export TP_WP_HARNESS="$run_root/harness.json"
  [[ $TP_WP_PROJECT =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid coediting project name.' >&2; exit 2; }
  if [[ -n $(docker ps -a --filter "label=com.docker.compose.project=$TP_WP_PROJECT" --format '{{.ID}}') ]]; then
    echo "Project $TP_WP_PROJECT already exists. Choose a new TP_WP_PROJECT or use TP_COEDITING_EXISTING=1 with its receipt." >&2
    exit 2
  fi
  compiler="${TP_COEDITING_COMPILER:-${CARGO_TARGET_DIR:-$repo/target}/debug/typedpress}"
  [[ -x "$compiler" ]] || { echo 'Build the compiler or set TP_COEDITING_COMPILER.' >&2; exit 1; }
  mkdir -p "$run_root/app"
  cp "$here/typedpress.config.ts" "$run_root/app/typedpress.config.ts"
  "$compiler" build "$run_root/app" --quiet
  # Keep the mount stable, even if a caller later rebuilds the source artifact.
  mkdir -p "$run_root/wp-content"
  cp -a "$run_root/app/tp/dist/wp-content/." "$run_root/wp-content/"
  export TP_WP_CONTENT="$run_root/wp-content"
  printf 'project=%s\nport=%s\ncontent=%s\nreceipt=%s\n' "$TP_WP_PROJECT" "$TP_WP_PORT" "$TP_WP_CONTENT" "$TP_WP_HARNESS" > "$run_root/ownership.txt"
  "$repo/tests/wp/harness.sh" up --wp-content "$TP_WP_CONTENT" > "$TP_WP_HARNESS"
  "$repo/tests/wp/harness.sh" wp option update gutenberg-experiments '{"gutenberg-real-time-collaboration":true}' --format=json >/dev/null
  echo "Coediting local stack retained: $run_root/ownership.txt"
else
  : "${TP_WP_HARNESS:?Set TP_WP_HARNESS to the isolated coediting fixture receipt}"
fi
exec "$browser" test --config "$repo/runtime/admin/apps/wp-journey/coediting.config.ts"
