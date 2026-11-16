#!/usr/bin/env bash
# The WordPress-ahead workflow's one tracking issue: a failing run opens it (or updates it when it is
# already open) with each failing lane's summary; a green run closes it. Nobody is assigned or
# mentioned. Reads the per-lane summaries the jobs uploaded and their results from RESULTS (the
# workflow's `needs` as JSON).
#   report.sh <directory of <lane>-<build>.md summaries>
set -euo pipefail
dir=$1
title='WordPress ahead: TypedPress fails on an upcoming WordPress'
label='wordpress-ahead'

failed=$(jq -r 'to_entries[] | select(.key != "builds" and .value.result != "success" and .value.result != "skipped") | .key' <<<"$RESULTS")
builds_failed=$(jq -r '.builds.result' <<<"$RESULTS")

gh label create "$label" --color BFD4F2 --description 'TypedPress on WordPress nightly or the next beta' >/dev/null 2>&1 || true
open=$(gh issue list --label "$label" --state open --json number --jq '.[0].number // empty')

if [ -z "$failed" ] && [ "$builds_failed" = success ]; then
  if [ -n "$open" ]; then
    gh issue close "$open" --comment "Green again: every lane passed on every build in $RUN_URL."
    echo "Closed #$open."
  else
    echo "Green; no tracking issue open."
  fi
  exit 0
fi

body=$(mktemp)
{
  echo "TypedPress's lanes failed on an upcoming WordPress in $RUN_URL."
  echo
  if [ "$builds_failed" != success ]; then
    echo "Picking the builds failed (\`builds\`: $builds_failed): wordpress.org's version API or the nightly download."
    echo
  fi
  if [ -n "$failed" ]; then
    echo "Failing jobs: $(tr '\n' ' ' <<<"$failed")"
    echo
  fi
  shopt -s nullglob
  for status in "$dir"/*.status; do
    [ "$(cat "$status")" = success ] && continue
    summary="${status%.status}.md"
    if [ -s "$summary" ]; then
      cat "$summary"
    else
      echo "### $(basename "${status%.status}")"
      echo "The lane failed before it wrote a summary (see the run)."
    fi
    echo
  done
  echo "This issue closes itself on the next run where every lane passes. What TypedPress relies on in WordPress, and what to check first: docs/wordpress-internals.md."
} > "$body"

if [ -n "$open" ]; then
  gh issue edit "$open" --body-file "$body" >/dev/null
  gh issue comment "$open" --body "Still failing in $RUN_URL (the description is updated)." >/dev/null
  echo "Updated #$open."
else
  url=$(gh issue create --title "$title" --label "$label" --body-file "$body")
  echo "Opened $url."
fi
