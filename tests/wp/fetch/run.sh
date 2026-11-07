#!/usr/bin/env bash
# fetch() from handlers on real WordPress/MariaDB against a host-side HTTPS origin.
#   ZERO_WP_PROJECT=zero-wp-fetch ZERO_WP_PORT=8899 tests/wp/fetch/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
wp="$(cd "$here/.." && pwd)"
repo="$(cd "$wp/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-wp-fetch}"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8899}"
work="$(mktemp -d)"
receiver=""
cleanup() { [[ -n $receiver ]] && kill "$receiver" 2>/dev/null; "$wp/harness.sh" down >/dev/null; rm -rf "$work"; }
trap cleanup EXIT
# A throwaway CA and a certificate for the lane's origin name; neither leaves $work.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=zero fetch lane CA" \
  -keyout "$work/ca.key" -out "$work/ca.pem" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=fetch-origin.test" -keyout "$work/origin.key" -out "$work/origin.csr" 2>/dev/null
printf 'subjectAltName=DNS:fetch-origin.test\n' > "$work/ext"
openssl x509 -req -in "$work/origin.csr" -CA "$work/ca.pem" -CAkey "$work/ca.key" -CAcreateserial \
  -days 1 -extfile "$work/ext" -out "$work/origin.pem" 2>/dev/null
: > "$work/requests.log"
node "$here/receiver.mjs" "$work/origin.key" "$work/origin.pem" "$work/requests.log" > "$work/port" &
receiver=$!
for _ in $(seq 50); do [[ -s $work/port ]] && break; sleep 0.1; done
port="$(cat "$work/port")"
mkdir "$work/app"
cp "$here/zero.config.ts" "$work/app/"
"$target/debug/zero" build "$work/app" --quiet >/dev/null
"$wp/harness.sh" up --wp-content "$work/app/.zero/wp-content" > "$work/harness.json"
# The CA and the lane's one trusted origin, for the web server only.
"$wp/harness.sh" compose exec -T wordpress mkdir -p /zero-fetch
"$wp/harness.sh" compose cp "$work/ca.pem" wordpress:/zero-fetch/ca.pem >/dev/null 2>&1
"$wp/harness.sh" compose cp "$(cd "$here" && pwd)/mu-plugin.php" wordpress:/var/www/html/wp-content/mu-plugins/zero-fetch-lane.php >/dev/null 2>&1
ZERO_WP_HARNESS="$work/harness.json" ZERO_FETCH_PORT="$port" ZERO_FETCH_LOG="$work/requests.log" \
  node --test "$here/fetch.test.ts"
