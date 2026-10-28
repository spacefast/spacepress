#!/usr/bin/env bash
# Boots a throwaway WordPress 7.1 + MariaDB + SCF 6.9.7, installs the plugin
# directory given as $1 (a built Zero WP target), and prints, as JSON on the
# last line: {"url":..., "user":"admin", "appPassword":...}.
# Usage: tests/wp/up.sh [plugin-dir] ; tests/wp/down.sh to remove everything.
set -euo pipefail
cd "$(dirname "$0")"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8790}"
if [[ $# -ge 1 ]]; then
  export ZERO_WP_PLUGIN_DIR="$(cd "$1" && pwd)"
else
  export ZERO_WP_PLUGIN_DIR="$PWD/empty-plugin"
fi
SCF_ZIP=cache/secure-custom-fields.6.9.7.zip
SCF_SHA=5b10edab948f64b84d44d81a29fd5794a2573205e0d5e7ea9538024fc93ff52c
if [[ ! -f $SCF_ZIP ]]; then
  curl -sSfL -o "$SCF_ZIP" https://downloads.wordpress.org/plugin/secure-custom-fields.6.9.7.zip
fi
echo "$SCF_SHA  $SCF_ZIP" | sha256sum -c --quiet
URL="http://127.0.0.1:${ZERO_WP_PORT}"
docker compose up -d --wait >/dev/null 2>&1 || docker compose up -d --wait
wp() { docker compose run --rm -T cli wp "$@" 2> >(grep -v "^ Container " >&2); }
# Wait until the container has copied WordPress into the volume.
for _ in $(seq 1 120); do
  docker compose exec -T wordpress test -f /var/www/html/wp-includes/version.php && break
  sleep 0.5
done
if ! wp core is-installed >/dev/null 2>&1; then
  wp core install --url="$URL" --title="Zero Test" --admin_user=admin \
    --admin_password=zero-test-admin --admin_email=admin@example.test --skip-email >/dev/null
  wp rewrite structure '/%postname%/' >/dev/null
fi
wp plugin is-installed secure-custom-fields >/dev/null 2>&1 || wp plugin install /zero-cache/secure-custom-fields.6.9.7.zip >/dev/null
wp plugin activate secure-custom-fields >/dev/null
if [[ -f "$ZERO_WP_PLUGIN_DIR/zero-app.php" ]]; then
  wp plugin activate zero-app >/dev/null
fi
APP_PASSWORD=$(wp user application-password create admin "zero-tests-$(date +%s%N)" --porcelain)
VERSION=$(wp core version)
printf '{"url":"%s","user":"admin","appPassword":"%s","wordpress":"%s","scf":"6.9.7"}\n' "$URL" "$APP_PASSWORD" "$VERSION"
