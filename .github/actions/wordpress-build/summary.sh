#!/usr/bin/env bash
# The job summary for a WordPress-ahead lane (.github/workflows/wordpress-ahead.yml): the WordPress build, then each failing test by name with
# the first lines of its error, from the lane's log (node:test TAP and tests/php "FAIL" lines).
#   summary.sh <build name> <wp version> <lane> <log>
set -uo pipefail
name=$1 version=$2 lane=$3 log=$4
out=${GITHUB_STEP_SUMMARY:-/dev/stdout}
{
  echo "### $lane on WordPress ${version:-?} ($name)"
  if [ ! -s "$log" ]; then
    echo "The lane wrote no log: it failed before its tests ran (see the job's steps)."
    exit 0
  fi
  failed=$( { grep -E '^not ok [0-9]+ - ' "$log" | sed -E 's/^not ok [0-9]+ - /- /'; grep -E '^ *FAIL ' "$log" | sed -E 's/^ *FAIL +/- /'; grep -E '^[a-z_]+: [0-9]+ passed, [1-9][0-9]* failed' "$log" | sed 's/^/- suite /'; grep -E 'PHP (Fatal error|Warning|Deprecated):' "$log" | sort -u | head -20 | sed 's/^/- /'; } )
  if [ -z "$failed" ]; then
    echo "Every test passed."
    exit 0
  fi
  echo "Failing, by name:"
  echo
  echo "$failed"
  echo
  echo "<details><summary>First lines of each failure</summary>"
  echo
  echo '```'
  grep -E -A24 '^not ok [0-9]+ - ' "$log" | grep -vE '^ *(---|\.\.\.|duration_ms|type:|failureType|code:|name:|operator:|stack:|TestContext|Test\.|process\.|async |startSubtest)' | grep -vE '^(ok |# Subtest)' | head -150
  grep -E -B2 -A6 '^ *FAIL ' "$log" | head -80
  echo '```'
  echo "</details>"
  echo
  # Which core changes: a nightly's version ends in its SVN revision (7.2-beta5-65523); the core
  # commits up to it are trunk's Trac log, which holds the floor (7.2-beta5) too. A beta or RC names its tag.
  rev=$(sed -nE 's/^.*-([0-9]{5,})$/\1/p' <<<"$version")
  if [ -n "$rev" ]; then
    echo "Core changes up to r$rev: https://core.trac.wordpress.org/log/trunk?rev=$rev (First's floor, 7.2-beta5, is on trunk too)"
  else
    echo "Core changes in this build: https://core.trac.wordpress.org/browser/tags/$version (its milestone's tickets list what changed)"
  fi
  echo
  echo "What First relies on in core, and what to check first: docs/wordpress-internals.md."
} >> "$out"
