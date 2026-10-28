#!/usr/bin/env bash
# Disposable WordPress 7.1 + MariaDB 11.4 + SCF 6.9.7 for Zero's WP target (design §9.2).
#
#   harness.sh up [--plugin <dir>]   boot, install SCF + the plugin dir (slug = dir name), activate it,
#                                    create admin/editor/author/subscriber with application passwords;
#                                    prints ONE JSON line (url, versions, users, container)
#   harness.sh up ... --env          print shell exports instead of JSON
#   harness.sh wp <args...>          WP-CLI inside the stack
#   harness.sh sql "<query>"         run SQL in MariaDB; tab-separated rows with a header line
#   harness.sh down                  remove containers and volumes
#
# ZERO_WP_PORT (default 8790) picks the host port. Credentials here are throwaway values for this
# local container only and are tracked intentionally.
set -euo pipefail
cd "$(dirname "$0")"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8790}"
STATE=.harness-state
[[ -f $STATE ]] && source "$STATE"
export ZERO_WP_PLUGIN_DIR="${ZERO_WP_PLUGIN_DIR:-$PWD/empty-plugin}"
export ZERO_WP_PLUGIN_SLUG="${ZERO_WP_PLUGIN_SLUG:-zero-app}"

compose() { docker compose "$@"; }
wp() { compose exec -T cli wp "$@"; }
sql() { compose exec -T db mariadb -uwordpress -pzero-test-db wordpress --batch -e "$1"; }

up() {
  local plugin="" env=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --plugin) plugin="$2"; shift 2 ;;
      --env) env=1; shift ;;
      *) plugin="$1"; shift ;;
    esac
  done
  plugin="${plugin:-${ZERO_WP_PLUGIN:-}}"
  if [[ -n $plugin ]]; then
    ZERO_WP_PLUGIN_DIR="$(cd "$plugin" && pwd)"
    ZERO_WP_PLUGIN_SLUG="$(basename "$ZERO_WP_PLUGIN_DIR")"
  fi
  printf 'export ZERO_WP_PLUGIN_DIR=%q\nexport ZERO_WP_PLUGIN_SLUG=%q\n' "$ZERO_WP_PLUGIN_DIR" "$ZERO_WP_PLUGIN_SLUG" > "$STATE"

  local zip=cache/secure-custom-fields.6.9.7.zip sha=5b10edab948f64b84d44d81a29fd5794a2573205e0d5e7ea9538024fc93ff52c
  [[ -f $zip ]] || curl -sSfL -o "$zip" https://downloads.wordpress.org/plugin/secure-custom-fields.6.9.7.zip
  echo "$sha  $zip" | sha256sum -c --quiet

  local url="http://127.0.0.1:${ZERO_WP_PORT}"
  compose up -d --wait >/dev/null 2>&1 || compose up -d --wait
  # Poll until the image has copied WordPress into the volume.
  for _ in $(seq 1 240); do
    compose exec -T wordpress test -f /var/www/html/wp-includes/version.php && break
    sleep 0.25
  done
  if ! wp core is-installed >/dev/null 2>&1; then
    wp core install --url="$url" --title="Zero Test" --admin_user=admin --admin_password=zero-test-admin \
      --admin_email=admin@example.test --skip-email >/dev/null
    wp rewrite structure '/%postname%/' >/dev/null
    for role in editor author subscriber; do
      wp user create "$role" "$role@example.test" --role="$role" --display_name="${role^}" --user_pass="zero-test-$role" >/dev/null
    done
  fi
  wp plugin is-installed secure-custom-fields >/dev/null 2>&1 || wp plugin install /zero-cache/secure-custom-fields.6.9.7.zip >/dev/null
  wp plugin activate secure-custom-fields >/dev/null
  if [[ $ZERO_WP_PLUGIN_SLUG != zero-app ]]; then
    wp plugin activate "$ZERO_WP_PLUGIN_SLUG" >/dev/null
  fi

  local users="" sep="" id pass
  for role in admin editor author subscriber; do
    id=$(wp user get "$role" --field=ID)
    pass=$(wp user application-password create "$role" "zero-tests-$(date +%s%N)" --porcelain)
    users+="$sep\"$role\":{\"id\":$id,\"appPassword\":\"$pass\"}"
    sep=","
    if [[ $env == 1 ]]; then
      printf 'export ZERO_WP_%s_ID=%s\nexport ZERO_WP_%s_APP_PASSWORD=%q\n' "${role^^}" "$id" "${role^^}" "$pass"
    fi
  done
  local version container
  version=$(wp core version)
  container=$(compose ps -q wordpress)
  if [[ $env == 1 ]]; then
    printf 'export ZERO_WP_URL=%q\nexport ZERO_WP_VERSION=%q\n' "$url" "$version"
  else
    printf '{"url":"%s","wp":"%s","scf":"6.9.7","plugin":"%s","users":{%s},"container":"zero-wp-%s"}\n' \
      "$url" "$version" "$ZERO_WP_PLUGIN_SLUG" "$users" "${container:0:12}"
  fi
}

cmd="${1:-}"
shift || true
case "$cmd" in
  up) up "$@" ;;
  wp) wp "$@" ;;
  sql) sql "$1" ;;
  down)
    compose down -v --remove-orphans >/dev/null 2>&1
    rm -f "$STATE"
    ;;
  *) sed -n '2,12p' "$0" >&2; exit 2 ;;
esac
