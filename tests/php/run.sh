#!/usr/bin/env bash
# Runs the PHP runtime suites. Usage: tests/php/run.sh [js|db|schema|sql|blog|auth|images|files ...]
#
# Pure suites (js, env, query, schema, sql, images, legacy, vendor) need PHP alone. The WordPress suites (db, blog,
# auth, jobs, webhooks, services, files, media, locales, sync) boot a real WordPress on SQLite in-process (tests/php/wp.php):
# WordPress core and the pinned plugins are downloaded once into tests/wp/cache (ZERO_WP_CACHE
# overrides); the site itself lives in a temp dir per suite. ZERO_WP_KEEP=1 keeps it afterwards.
set -euo pipefail
cd "$(dirname "$0")"
PHP="${PHP:-php}"
status=0
suites=("$@")
[ ${#suites[@]} -eq 0 ] && suites=(js env query db schema sql blog auth jobs webhooks realtime services images files media locales sync legacy vendor boundary)
for s in "${suites[@]}"; do
  case "$s" in
    js) "$PHP" -d zend.assertions=1 js_parity.php || status=1 ;;
    env|query|schema|sql|images|legacy|boundary) "$PHP" -d zend.assertions=1 "${s}_test.php" || status=1 ;;
    db|blog|auth|jobs|webhooks|realtime|services|files|media|locales|sync) "$PHP" -d zend.assertions=1 -d memory_limit=512M "${s}_test.php" || status=1 ;;
    vendor)
      "$PHP" -d zend.assertions=1 vendor_drift.php || status=1
      "$PHP" -d zend.assertions=1 autoload_test.php || status=1
      ;;
    *) echo "unknown suite: $s" >&2; exit 2 ;;
  esac
done
exit $status
