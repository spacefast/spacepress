#!/usr/bin/env bash
# Runs the PHP runtime suites. Usage: tests/php/run.sh [js|db|schema|sql|blog|auth|images|files ...]
#
# Pure suites (js, env, query, schema, sql, images, vendor) need PHP alone. The WordPress suites (db, blog, guard, search, searchable,
# auth, identity_callback, connectors, jobs, webhooks, realtime, live, files, media, locales, sync, sync_notrash, markdown, spam, harness, staged, taxonomy) boot a real WordPress on SQLite in-process (tests/php/wp.php):
# WordPress core and the pinned plugins are downloaded once into tests/wp/cache (SP_WP_CACHE
# overrides); the site itself lives in a temp dir per suite. SP_WP_KEEP=1 keeps it afterwards.
set -euo pipefail
cd "$(dirname "$0")"
PHP="${PHP:-php}"
status=0
suites=("$@")
[ ${#suites[@]} -eq 0 ] && suites=(js bigint env fetch crypto query deployments db destructive_migrations schema runtimeschema sql blog auth jobs mail abilities search searchable webhooks realtime live images files identity_callback connectors media locales sync sync_notrash vendor boundary markdown spam harness staged coediting core_shape guard taxonomy trash git_dispatch install_marker brand_upgrade brand_upgrade_identity brand_upgrade_cron storage_engine page_reads columns mcp_boot admin_boot theme_styles)
for s in "${suites[@]}"; do
  case "$s" in
    js) "$PHP" -d zend.assertions=1 js_parity.php || status=1 ;;
    env) "$PHP" -d zend.assertions=1 bootstrap_test.php || status=1
         "$PHP" -d zend.assertions=1 env_test.php || status=1
         "$PHP" -d zend.assertions=1 host_test.php || status=1 ;;
    fetch|crypto|query|schema|sql|images|boundary|bigint|brand_upgrade_cron) "$PHP" -d zend.assertions=1 "${s}_test.php" || status=1 ;;
    runtimeschema) "$PHP" -d zend.assertions=1 runtimeschema_corpus.php || status=1
                   "$PHP" -d zend.assertions=1 -d memory_limit=512M runtimeschema_test.php || status=1 ;;
    realtime) "$PHP" -d zend.assertions=1 -d memory_limit=512M realtime_test.php || status=1
              "$PHP" -d zend.assertions=1 -d memory_limit=512M realtime_comments_test.php || status=1 ;;
    deployments|db|destructive_migrations|blog|auth|jobs|mail|abilities|search|searchable|webhooks|live|files|identity_callback|connectors|media|locales|sync|sync_notrash|markdown|spam|harness|staged|coediting|core_shape|guard|taxonomy|trash|git_dispatch|install_marker|brand_upgrade|brand_upgrade_identity|storage_engine|page_reads|columns|mcp_boot|admin_boot|theme_styles) "$PHP" -d zend.assertions=1 -d memory_limit=512M "${s}_test.php" || status=1 ;;
    vendor)
      "$PHP" -d zend.assertions=1 vendor_drift.php || status=1
      "$PHP" runtime_lint.php || status=1
      "$PHP" -d zend.assertions=1 autoload_test.php || status=1
      ;;
    *) echo "unknown suite: $s" >&2; exit 2 ;;
  esac
done
exit $status
