#!/usr/bin/env bash
# Disposable WordPress 7.1 + MariaDB 11.4 + pinned platform plugins for Zero's WP target (design §9.2).
#
#   harness.sh up --wp-content <dir> boot and activate the declared split plugins,
#                                    create admin/editor/author/subscriber with application passwords;
#                                    prints ONE JSON line (url, versions, users, container)
#   harness.sh up ... --env          print shell exports instead of JSON
#   harness.sh up --wp-content <dir> --bare
#                                    a fresh WordPress with users only: no plugin is installed or
#                                    activated, so the caller installs an artifact as a site owner would
#   harness.sh wp <args...>          WP-CLI inside the stack
#   harness.sh sql "<query>"         run SQL in MariaDB; tab-separated rows with a header line
#   harness.sh down                  remove containers and volumes
#
# ZERO_WP_PORT (default 8790) picks the host port and ZERO_WP_PROJECT (default zero-wp-test) the
# compose project, so several worktrees can each run their own stack at once. Credentials here are
# throwaway values for this local container only and are tracked intentionally.
set -euo pipefail
caller="$PWD"   # relative --wp-content paths are the caller's, not this directory's
cd "$(dirname "$0")"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8790}"
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-wp-test}"
# Compose lowercases and strips other characters, so distinct inputs could share one stack.
[[ $ZERO_WP_PROJECT =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "ZERO_WP_PROJECT must match ^[a-z0-9][a-z0-9_-]*\$" >&2; exit 2; }
export ZERO_WP_UID="$(id -u)" ZERO_WP_GID="$(id -g)"
STATE=.harness-state
[[ -f $STATE ]] && source "$STATE"
export ZERO_WP_CONTENT="${ZERO_WP_CONTENT:-$PWD/empty-wp-content}"

# -p wins over an inherited COMPOSE_PROJECT_NAME, which would otherwise merge stacks.
compose() { docker compose -p "$ZERO_WP_PROJECT" "$@"; }
wp() { compose exec -T cli wp "$@"; }
sql() { compose exec -T db mariadb -uwordpress -pzero-test-db wordpress --batch -e "$1"; }

up() {
  local content="${ZERO_WP_CONTENT}" env=0 bare=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --wp-content) content="$2"; shift 2 ;;
      --env) env=1; shift ;;
      --bare) bare=1; shift ;;
      *) echo "unknown argument $1; use --wp-content <dir>" >&2; exit 2 ;;
    esac
  done
  [[ $content == /* ]] || content="$caller/$content"
  ZERO_WP_CONTENT="$(cd "$content" && pwd)"
  export ZERO_WP_CONTENT
  [[ $bare == 1 || -f $ZERO_WP_CONTENT/zero-manifest.json ]] || { echo 'build a wp-content artifact first' >&2; exit 1; }
  printf 'export ZERO_WP_CONTENT=%q\n' "$ZERO_WP_CONTENT" > "$STATE"
  mkdir -p cache
  local slug version sha zip
  local -a pins=()
  [[ $bare == 1 ]] || mapfile -t pins < <(python3 - "$ZERO_WP_CONTENT/zero-manifest.json" ../fixtures/platform.json <<'PINS'
import json,sys
manifest=json.load(open(sys.argv[1])); platform=json.load(open(sys.argv[2]))
for slug,spec in platform['plugins'].items():
 if slug != 'polylang' or slug in manifest['requires']: print(slug,spec['version'],spec['sha256'])
PINS
  )
  local pin
  for pin in "${pins[@]}"; do
    read -r slug version sha <<< "$pin"
    zip="cache/$slug.$version.zip"
    [[ -f $zip ]] || curl -sSfL -o "$zip" "https://downloads.wordpress.org/plugin/$slug.$version.zip"
    printf '%s  %s\n' "$sha" "$zip" | sha256sum -c --quiet
  done

  local url="http://127.0.0.1:${ZERO_WP_PORT}"
  compose up -d --wait >/dev/null 2>&1 || compose up -d --wait
  if ! wp core is-installed >/dev/null 2>&1; then
    wp core install --url="$url" --title="Zero Test" --admin_user=admin --admin_password=zero-test-admin \
      --admin_email=admin@example.test --skip-email >/dev/null
    wp rewrite structure '/%postname%/' >/dev/null
    for role in editor author subscriber; do
      wp user create "$role" "$role@example.test" --role="$role" --display_name="${role^}" --user_pass="zero-test-$role" >/dev/null
    done
  fi
  local installed
  for pin in "${pins[@]}"; do
    read -r slug version sha <<< "$pin"
    wp plugin is-installed "$slug" >/dev/null 2>&1 || wp plugin install "/zero-cache/$slug.$version.zip" >/dev/null
    installed=$(wp plugin get "$slug" --field=version)
    php -r 'exit(version_compare($argv[1],$argv[2],">=") ? 0 : 1);' "$installed" "$version" || { echo "$slug $version+ required" >&2; exit 1; }
  done
  local app=null
  [[ $bare == 1 ]] || app=$(python3 -c 'import json,sys; print(json.dumps("zero-app-"+json.load(open(sys.argv[1]))["app"]))' "$ZERO_WP_CONTENT/zero-manifest.json")
  local -a activation=()
  [[ $bare == 1 ]] || mapfile -t activation < <(python3 - "$ZERO_WP_CONTENT/zero-manifest.json" <<'ACTIVATE'
import json,sys,os
manifest=json.load(open(sys.argv[1]))
for dependency in manifest['dependencies']: print(dependency['slug'])
print('zero-runtime')
if 'zero-identity' in manifest['plugins']: print('zero-identity')
print('zero-app-'+manifest['app'])
ACTIVATE
  )
  for slug in "${activation[@]}"; do wp plugin activate "$slug" >/dev/null; done
  # Test-only must-use plugins (outgoing mail kept on disk for sign-in codes).
  wp eval 'wp_mkdir_p(WPMU_PLUGIN_DIR); foreach (glob("/zero-mu-plugins/*.php") as $f) { copy($f, WPMU_PLUGIN_DIR . "/zero-harness-" . basename($f)); }' >/dev/null

  local identity=null
  if wp cli has-command 'zero-identity app add' >/dev/null 2>&1; then
    local application client_id
    application=$(wp zero-identity app add --name='Zero development' --redirect="$url/auth/callback" --origin="$url" --id=app_zero_dev)
    client_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<< "$application")
    identity=$(python3 -c 'import json,sys; print(json.dumps({"clientId":sys.argv[1]}))' "$client_id")
    [[ $env == 0 ]] || printf 'export ZERO_IDENTITY_CLIENT_ID=%q\n' "$client_id"
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
    printf '{"url":"%s","wp":"%s","scf":"6.9.7","plugin":%s,"identity":%s,"users":{%s},"container":"zero-wp-%s"}\n' \
      "$url" "$version" "$app" "$identity" "$users" "${container:0:12}"
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
  *) sed -n '2,15p' "$0" >&2; exit 2 ;;
esac
