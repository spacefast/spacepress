#!/usr/bin/env bash
# Runs the PHP runtime suites. Usage: tests/php/run.sh [js|db|schema|sql|blog|auth|images|files ...]
#
# Pure suites (js, env, query, schema, sql, images, legacy, vendor) need PHP alone. The WordPress suites (db, blog, guard, search,
# auth, jobs, webhooks, realtime, live, services, files, media, locales, sync, markdown, spam, harness, staged, taxonomy) boot a real WordPress on SQLite in-process (tests/php/wp.php):
# WordPress core and the pinned plugins are downloaded once into tests/wp/cache (FIRST_WP_CACHE
# overrides); the site itself lives in a temp dir per suite. FIRST_WP_KEEP=1 keeps it afterwards.
set -euo pipefail
cd "$(dirname "$0")"
PHP="${PHP:-php}"
status=0
suites=("$@")
[ ${#suites[@]} -eq 0 ] && suites=(js bigint env fetch crypto query db schema runtimeschema sql blog auth jobs mail abilities search webhooks realtime live services images files media locales sync legacy vendor boundary markdown spam harness staged core_shape guard taxonomy trash git_dispatch install_marker page_reads columns due mcp_boot)
for s in "${suites[@]}"; do
  case "$s" in
    js) "$PHP" -d zend.assertions=1 js_parity.php || status=1 ;;
    env) "$PHP" -d zend.assertions=1 bootstrap_test.php || status=1
         "$PHP" -d zend.assertions=1 env_test.php || status=1
         "$PHP" -d zend.assertions=1 host_test.php || status=1 ;;
    fetch|crypto|query|schema|sql|images|legacy|boundary|bigint) "$PHP" -d zend.assertions=1 "${s}_test.php" || status=1 ;;
    runtimeschema) "$PHP" -d zend.assertions=1 runtimeschema_corpus.php || status=1
                   "$PHP" -d zend.assertions=1 -d memory_limit=512M runtimeschema_test.php || status=1 ;;
    realtime) "$PHP" -d zend.assertions=1 -d memory_limit=512M realtime_test.php || status=1
              "$PHP" -d zend.assertions=1 -d memory_limit=512M realtime_comments_test.php || status=1 ;;
    db|blog|auth|jobs|mail|abilities|search|webhooks|live|services|files|media|locales|sync|markdown|spam|harness|staged|core_shape|guard|taxonomy|trash|git_dispatch|install_marker|page_reads|columns|due|mcp_boot) "$PHP" -d zend.assertions=1 -d memory_limit=512M "${s}_test.php" || status=1 ;;
    vendor)
      "$PHP" -d zend.assertions=1 vendor_drift.php || status=1
      "$PHP" runtime_lint.php || status=1
      "$PHP" -d zend.assertions=1 autoload_test.php || status=1
      ;;
    *) echo "unknown suite: $s" >&2; exit 2 ;;
  esac
done
exit $status
