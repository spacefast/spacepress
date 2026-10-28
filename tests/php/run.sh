#!/usr/bin/env bash
# Runs the PHP runtime suites. Usage: tests/php/run.sh [js|db]
set -euo pipefail
cd "$(dirname "$0")"
PHP="${PHP:-php}"
status=0
suites=("$@")
[ ${#suites[@]} -eq 0 ] && suites=(js db)
for s in "${suites[@]}"; do
  case "$s" in
    js) "$PHP" -d zend.assertions=1 js_parity.php || status=1 ;;
    db) "$PHP" -d zend.assertions=1 db_test.php || status=1 ;;
    *) echo "unknown suite: $s" >&2; exit 2 ;;
  esac
done
exit $status
