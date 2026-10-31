#!/usr/bin/env bash
# The zero-identity acceptance suite (design §3.2, §9.5): the plugin from runtime/identity on a
# disposable WordPress 7.1 + MariaDB 11.4 + Mailpit, PHP suites inside the container and the
# browser-less OAuth flow over HTTP from the host.
#
#   IDENTITY_PORT (default 8814)        WordPress on the host; Mailpit's API is IDENTITY_PORT+1
#   IDENTITY_PROJECT                    compose project (default zero-identity-<uid>)
#   IDENTITY_WORDPRESS_IMAGE / _CLI_IMAGE  PHP version under test (CI runs 8.2 and 8.5)
#   IDENTITY_KEEP=1                     leave the stack up afterwards
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
export IDENTITY_PORT="${IDENTITY_PORT:-8814}"
export IDENTITY_MAIL_PORT="$((IDENTITY_PORT + 1))"
export IDENTITY_PROJECT="${IDENTITY_PROJECT:-zero-identity-$(id -u)}"
export IDENTITY_UID="$(id -u)" IDENTITY_GID="$(id -g)"
export IDENTITY_URL="http://127.0.0.1:$IDENTITY_PORT"
[[ $IDENTITY_PROJECT =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "IDENTITY_PROJECT must match ^[a-z0-9][a-z0-9_-]*\$" >&2; exit 2; }

# The plugin exactly as `zero build` emits it: runtime/identity minus maintainer-only sources.
stage="$(mktemp -d)"
export IDENTITY_PLUGIN_DIR="$stage/zero-identity"
rsync -a --exclude apps --exclude 'composer.*' --exclude vendor "$repo/runtime/identity/" "$IDENTITY_PLUGIN_DIR/"
chmod -R a+rX "$stage"

compose() { docker compose -p "$IDENTITY_PROJECT" -f "$here/compose.yml" "$@"; }
cleanup() {
  [[ ${IDENTITY_KEEP:-0} == 1 ]] || compose down --volumes --remove-orphans >/dev/null 2>&1
  [[ ${IDENTITY_KEEP:-0} == 1 ]] || rm -rf "$stage"
}
trap cleanup EXIT
compose down --volumes --remove-orphans >/dev/null 2>&1 || true
compose up -d --wait database mailpit oidc webhook wordpress cli >/dev/null 2>&1 || compose up -d --wait database mailpit oidc webhook wordpress cli
wp() { compose exec -T cli wp "$@"; }
compose exec -T wordpress php -r 'echo "PHP ", PHP_VERSION, "\n";'
wp core install --url="$IDENTITY_URL" --title="Identity Test" --admin_user=identity-admin \
  --admin_password=disposable-admin-test --admin_email=admin@example.test --skip-email >/dev/null
wp rewrite structure '/%postname%/' >/dev/null
echo "WordPress $(wp core version)"
wp plugin activate zero-identity

suites=(migrations behavior security-capabilities admin-applications native-password credential-race email-race mfa-entrypoints webhooks provider-callback guests upgrade-race passkeys shared-transaction)
for suite in "${suites[@]}"; do
  compose exec -T wordpress php "/opt/identity-tests/$suite.php"
done
# Over real HTTP from the host: the PKCE flow, refresh rotation, Bearer on the REST API, CORS.
wp zero-identity app add --name='Identity flow' --redirect="http://127.0.0.1:18181/callback" \
  --origin="http://127.0.0.1:18181" --id=app_identity_flow >/dev/null
IDENTITY_MAIL="http://127.0.0.1:$IDENTITY_MAIL_PORT" node --test "$here/flow.test.ts"
# Reactivation keeps data and reruns the idempotent migration.
wp plugin deactivate zero-identity >/dev/null
wp plugin activate zero-identity >/dev/null
compose exec -T wordpress php /opt/identity-tests/migrations.php
