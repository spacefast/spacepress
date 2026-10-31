#!/usr/bin/env bash
# Runs the PHP runtime suites. Usage: tests/php/run.sh [js|db|schema|sql|blog|auth|images|files ...]
set -euo pipefail
cd "$(dirname "$0")"
PHP="${PHP:-php}"
status=0
suites=("$@")
[ ${#suites[@]} -eq 0 ] && suites=(js db schema sql blog auth jobs webhooks images files sync legacy vendor)
for s in "${suites[@]}"; do
  case "$s" in
    js) "$PHP" -d zend.assertions=1 js_parity.php || status=1 ;;
    db|schema|sql|blog|auth|jobs|webhooks|images|files|sync|legacy) "$PHP" -d zend.assertions=1 "${s}_test.php" || status=1 ;;
    vendor) "$PHP" -d zend.assertions=1 vendor_drift.php || status=1 ;;
    *) echo "unknown suite: $s" >&2; exit 2 ;;
  esac
done
exit $status
