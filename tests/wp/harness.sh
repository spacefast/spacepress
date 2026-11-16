#!/usr/bin/env bash
# Disposable WordPress 7.2-beta5 + MariaDB 11.4 + pinned platform plugins for First's WP target (design §9.2).
#
#   harness.sh up --wp-content <dir> boot and activate the declared split plugins,
#                                    create admin/editor/author/subscriber with application passwords;
#                                    prints ONE JSON line (url, versions, users, container)
#   harness.sh up ... --env          print shell exports instead of JSON
#   harness.sh up --wp-content <dir> --path blog
#                                    install WordPress below the origin root (http://host/blog/),
#                                    the layout a shared host gives it; the receipt's url includes the path
#   harness.sh up --wp-content <dir> --bare
#                                    a fresh WordPress with users only: no plugin is installed or
#                                    activated, so the caller installs an artifact as a site owner would
#   harness.sh up --wp-content <dir> --platform
#                                    install and activate only the manifest's platform dependencies; First
#                                    itself arrives another way (the build store's must-use loader)
#   harness.sh wp <args...>          WP-CLI inside the stack
#   harness.sh sql "<query>"         run SQL in MariaDB; tab-separated rows with a header line
#   harness.sh down                  remove containers and volumes
#
# FIRST_WP_PORT (default 8790) picks the host port and FIRST_WP_PROJECT (default first-wp-test) the
# compose project, so several worktrees can each run their own stack at once. Credentials here are
# throwaway values for this local container only and are tracked intentionally.
set -euo pipefail
caller="$PWD"   # relative --wp-content paths are the caller's, not this directory's
cd "$(dirname "$0")"
export FIRST_WP_PORT="${FIRST_WP_PORT:-8790}"
export FIRST_WP_PROJECT="${FIRST_WP_PROJECT:-first-wp-test}"
# Compose lowercases and strips other characters, so distinct inputs could share one stack.
[[ $FIRST_WP_PROJECT =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "FIRST_WP_PROJECT must match ^[a-z0-9][a-z0-9_-]*\$" >&2; exit 2; }
export FIRST_WP_UID="$(id -u)" FIRST_WP_GID="$(id -g)"
STATE=.harness-state
[[ -f $STATE ]] && source "$STATE"
export FIRST_WP_CONTENT="${FIRST_WP_CONTENT:-$PWD/empty-wp-content}"

# -p wins over an inherited COMPOSE_PROJECT_NAME, which would otherwise merge stacks.
compose() {
  local -a files=(-f compose.yml)
  [[ ${FIRST_WP_S3:-0} != 1 ]] || files+=(-f compose.s3.yml)
  docker compose -p "$FIRST_WP_PROJECT" "${files[@]}" "$@"
}
wp() { compose exec -T cli wp "$@"; }
sql() { compose exec -T db mariadb -uwordpress -pfirst-test-db wordpress --batch -e "$1"; }

# Provider provisioning is separate from installing/activating the WordPress artifact.
# Only the named disposable resources are owned here; a repeated setup retains their bytes.
s3_setup() {
  [[ ${FIRST_WP_S3:-0} == 1 ]] || { echo 's3-setup requires FIRST_WP_S3=1' >&2; exit 2; }
  local node layout_version
  layout_version=$(compose exec -T garage /garage json-api GetClusterLayout | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
  if [[ $layout_version == 0 ]]; then
    node=$(compose exec -T garage /garage node id | cut -d@ -f1)
    compose exec -T garage /garage layout assign -z test -c 1G "$node" >/dev/null
    compose exec -T garage /garage layout apply --version 1 >/dev/null
  fi
  if ! compose exec -T garage /garage bucket info first-uploads >/dev/null 2>&1; then
    compose exec -T garage /garage bucket create first-uploads >/dev/null
  fi
  if ! compose exec -T garage /garage key info GK111111111111111111111111 >/dev/null 2>&1; then
    compose exec -T garage /garage key import --yes -n first-test GK111111111111111111111111 1111111111111111111111111111111111111111111111111111111111111111 >/dev/null
  fi
  compose exec -T garage /garage bucket allow --read --write --owner first-uploads --key GK111111111111111111111111 >/dev/null
}

up() {
  local content="${FIRST_WP_CONTENT}" env=0 bare=0 platform=0 subdir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --wp-content) content="$2"; shift 2 ;;
      --env) env=1; shift ;;
      --bare) bare=1; shift ;;
      --platform) platform=1; shift ;;
      --path) subdir="${2#/}"; subdir="${subdir%/}"; shift 2 ;;
      *) echo "unknown argument $1; use --wp-content <dir>" >&2; exit 2 ;;
    esac
  done
  [[ $content == /* ]] || content="$caller/$content"
  FIRST_WP_CONTENT="$(cd "$content" && pwd)"
  export FIRST_WP_CONTENT
  [[ $bare == 1 || -f $FIRST_WP_CONTENT/first-manifest.json ]] || { echo 'build a wp-content artifact first' >&2; exit 1; }
  printf 'export FIRST_WP_CONTENT=%q\n' "$FIRST_WP_CONTENT" > "$STATE"
  mkdir -p cache
  local slug version sha zip
  local -a pins=()
  [[ $bare == 1 ]] || mapfile -t pins < <(python3 - "$FIRST_WP_CONTENT/first-manifest.json" ../fixtures/platform.json <<'PINS'
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
    if [[ ! -f $zip ]]; then
      # Verified under a private name, then published by rename: a concurrent `up` sharing this cache
      # never sees a partial ZIP.
      curl -sSfL -o "$zip.$$" "https://downloads.wordpress.org/plugin/$slug.$version.zip"
      printf '%s  %s\n' "$sha" "$zip.$$" | sha256sum -c --quiet || { rm -f "$zip.$$"; exit 1; }
      mv -f "$zip.$$" "$zip"
    fi
    printf '%s  %s\n' "$sha" "$zip" | sha256sum -c --quiet
  done

  local url="http://127.0.0.1:${FIRST_WP_PORT}"
  compose up -d --wait >/dev/null 2>&1 || compose up -d --wait
  if [[ ${FIRST_WP_S3:-0} == 1 ]]; then
    s3_setup
  fi
  if [[ -n $subdir ]]; then
    [[ $subdir =~ ^[a-z0-9-]+$ ]] || { echo '--path must be one lowercase path segment' >&2; exit 2; }
    # A real subdirectory install: the document root is a directory above WordPress holding only
    # the <subdir> link, so the site answers at /<subdir>/ and nothing answers at /. The image's
    # static .htaccess assumes the root; point its rewrite base and front controller at the sub-path.
    compose exec -T wordpress sh -c "mkdir -p /var/www/root && ln -sfn /var/www/html /var/www/root/$subdir \
      && sed -i 's#DocumentRoot /var/www/html#DocumentRoot /var/www/root#' /etc/apache2/sites-enabled/000-default.conf \
      && sed -i 's#^RewriteBase /\$#RewriteBase /$subdir/#; s#^RewriteRule \. /index\.php#RewriteRule . /$subdir/index.php#' /var/www/html/.htaccess \
      && apache2ctl -k graceful" >/dev/null
    url="$url/$subdir"
  fi
  if [[ -n ${FIRST_WP_CORE_ZIP:-} ]]; then
    # A WordPress build other than the image's (.github/workflows/wordpress-ahead.yml: nightly or a pre-release):
    # its files replace the image's core, wp-content and wp-config stay. The ZIP is under ./cache.
    compose exec -T --user "$FIRST_WP_UID:$FIRST_WP_GID" wordpress sh -c "cd /tmp && rm -rf core-swap && mkdir core-swap && cd core-swap \
      && php -r '\$z = new ZipArchive(); exit(\$z->open(\$argv[1]) === true && \$z->extractTo(\".\") ? 0 : 1);' /first-cache/${FIRST_WP_CORE_ZIP} \
      && rm -rf wordpress/wp-content && cp -a wordpress/. /var/www/html/ && cd / && rm -rf /tmp/core-swap" >/dev/null
  fi
  if ! wp core is-installed >/dev/null 2>&1; then
    wp core install --url="$url" --title="First Test" --admin_user=admin --admin_password=first-test-admin \
      --admin_email=admin@example.test --skip-email >/dev/null
    wp rewrite structure '/%postname%/' >/dev/null
    for role in editor author subscriber; do
      wp user create "$role" "$role@example.test" --role="$role" --display_name="${role^}" --user_pass="first-test-$role" >/dev/null
    done
  fi
  local installed
  for pin in "${pins[@]}"; do
    read -r slug version sha <<< "$pin"
    wp plugin is-installed "$slug" >/dev/null 2>&1 || wp plugin install "/first-cache/$slug.$version.zip" >/dev/null
    installed=$(wp plugin get "$slug" --field=version)
    php -r 'exit(version_compare($argv[1],$argv[2],">=") ? 0 : 1);' "$installed" "$version" || { echo "$slug $version+ required" >&2; exit 1; }
  done
  local app=null
  [[ $bare == 1 || $platform == 1 ]] || app=$(python3 -c 'import json,sys; print(json.dumps("first-app-"+json.load(open(sys.argv[1]))["app"]))' "$FIRST_WP_CONTENT/first-manifest.json")
  local -a activation=()
  [[ $bare == 1 ]] || mapfile -t activation < <(python3 - "$FIRST_WP_CONTENT/first-manifest.json" "$platform" <<'ACTIVATE'
import json,sys,os
manifest=json.load(open(sys.argv[1]))
for dependency in manifest['dependencies']: print(dependency['slug'])
if sys.argv[2] == '1': sys.exit()
print('first-runtime')
if 'first-identity' in manifest['plugins']: print('first-identity')
print('first-app-'+manifest['app'])
# The optional admin registers only once the app has (plugins_loaded order), so it activates last.
if 'first-admin' in manifest['plugins']: print('first-admin')
ACTIVATE
  )
  for slug in "${activation[@]}"; do wp plugin activate "$slug" >/dev/null; done
  # Test-only must-use plugins (outgoing mail kept on disk for sign-in codes).
  wp eval 'wp_mkdir_p(WPMU_PLUGIN_DIR); foreach (glob("/first-mu-plugins/*.php") as $f) { copy($f, WPMU_PLUGIN_DIR . "/first-harness-" . basename($f)); }' >/dev/null

  local identity=null
  if wp plugin is-active first-identity >/dev/null 2>&1; then
    local application client_id
    origin="${url%%/[^/]*}"; [[ $url == */* ]] && origin="$(printf %s "$url" | sed -E 's#^(https?://[^/]+).*#\1#')"
    application=$(wp first identity app add --name='First development' --redirect="$url/auth/callback" --origin="$origin" --id=app_zero_dev)
    client_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])' <<< "$application")
    identity=$(python3 -c 'import json,sys; print(json.dumps({"clientId":sys.argv[1]}))' "$client_id")
    [[ $env == 0 ]] || printf 'export FIRST_IDENTITY_CLIENT_ID=%q\n' "$client_id"
  fi

  local users="" sep="" id pass
  for role in admin editor author subscriber; do
    id=$(wp user get "$role" --field=ID)
    pass=$(wp user application-password create "$role" "first-tests-$(date +%s%N)" --porcelain)
    users+="$sep\"$role\":{\"id\":$id,\"appPassword\":\"$pass\"}"
    sep=","
    if [[ $env == 1 ]]; then
      printf 'export FIRST_WP_%s_ID=%s\nexport FIRST_WP_%s_APP_PASSWORD=%q\n' "${role^^}" "$id" "${role^^}" "$pass"
    fi
  done
  local version container
  version=$(wp core version)
  container=$(compose ps -q wordpress)
  if [[ $env == 1 ]]; then
    printf 'export FIRST_WP_URL=%q\nexport FIRST_WP_VERSION=%q\n' "$url" "$version"
  else
    printf '{"url":"%s","wp":"%s","scf":"6.9.7","plugin":%s,"identity":%s,"users":{%s},"container":"first-wp-%s"}\n' \
      "$url" "$version" "$app" "$identity" "$users" "${container:0:12}"
  fi
}

cmd="${1:-}"
shift || true
case "$cmd" in
  up) up "$@" ;;
  wp) wp "$@" ;;
  sql) sql "$1" ;;
  compose) compose "$@" ;;
  s3-setup) s3_setup ;;
  down)
    if [[ ${FIRST_WP_S3:-0} == 1 ]]; then
      compose --profile replica down -v --remove-orphans >/dev/null 2>&1
    else
      compose down -v --remove-orphans >/dev/null 2>&1
    fi
    rm -f "$STATE"
    ;;
  *) sed -n '2,15p' "$0" >&2; exit 2 ;;
esac
