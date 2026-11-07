#!/usr/bin/env bash
# Measure the merged state of every open files-sdk branch. Merges them into a
# local scratch worktree off origin/main (never pushed), builds the compiler,
# and prints the examples/files-sdk diagnostic table with the list of merged
# and conflicting branches.
#
#   scripts/files-sdk-merged.sh [scratch-dir]
#
# FILES_SDK_BRANCHES overrides the branch pattern (extended regex on branch names).
set -euo pipefail
repo=$(git rev-parse --show-toplevel)
scratch=${1:-${TMPDIR:-/tmp}/zero-files-sdk-merged}
pattern=${FILES_SDK_BRANCHES:-'^(feat/(files-sdk|ts-language-gaps|lang-|class-features|binary-data|async-streams|library-types|stdlib-objects|host-globals|plugin-capabilities))'}

git -C "$repo" fetch origin --quiet --prune
branches=$(gh pr list -R spacefast/zero --state open --limit 200 --json headRefName --jq '.[].headRefName' \
  | grep -E "$pattern" | sort -u || true)

if [ -d "$scratch/.git" ] || [ -f "$scratch/.git" ]; then
  git -C "$scratch" merge --abort 2>/dev/null || true
  git -C "$scratch" checkout --quiet --detach origin/main
  git -C "$scratch" reset --quiet --hard origin/main
else
  git -C "$repo" worktree add --quiet --detach "$scratch" origin/main
fi

merged=() conflicted=()
for branch in $branches; do
  if git -C "$scratch" merge --quiet --no-edit "origin/$branch" >/dev/null 2>&1; then
    merged+=("$branch@$(git -C "$repo" rev-parse --short "origin/$branch")")
  else
    git -C "$scratch" merge --abort
    conflicted+=("$branch@$(git -C "$repo" rev-parse --short "origin/$branch")")
  fi
done

cargo build --release --quiet --manifest-path "$scratch/Cargo.toml" --target-dir "$scratch/target"
# The harness files come from this checkout so every run measures the same probe.
harness="$scratch/examples/files-sdk"
mkdir -p "$harness"
rsync -a --delete --exclude node_modules --exclude .work "$repo/examples/files-sdk/" "$harness/"
[ -d "$harness/node_modules" ] || (cd "$harness" && npm ci --ignore-scripts --no-audit --no-fund --silent)
mkdir -p "$harness/.work"
for archive in "$repo"/examples/files-sdk/.work/files-sdk-*.tar.gz; do
  [ -f "$archive" ] && cp -n "$archive" "$harness/.work/"
done

label="merged state: origin/main $(git -C "$repo" rev-parse --short origin/main) + ${#merged[@]} branches, $(date -u +%Y-%m-%dT%H:%MZ)"
ZERO_BIN="$scratch/target/release/zero" node "$harness/table.mjs" --label "$label" --json "$scratch/files-sdk-table.json"
echo
echo "Merged: ${merged[*]:-none}"
echo "Conflicted (left out): ${conflicted[*]:-none}"
