#!/usr/bin/env bash
# Measure the merged state of every files-sdk branch. Merges each pushed
# origin/ branch whose name matches the pattern (with or without a PR) into a
# local scratch worktree off origin/main, never pushed, builds the compiler,
# and prints the examples/files-sdk diagnostic and host-API tables, the merged
# branches, and each conflicting branch with the files it conflicts in.
#
#   scripts/files-sdk-merged.sh [scratch-dir]
#
# FILES_SDK_BRANCHES overrides the branch pattern (extended regex on names
# without the origin/ prefix). Merge order is oldest commit first, so stacked
# branches land after their base.
set -euo pipefail
repo=$(git rev-parse --show-toplevel)
scratch=${1:-${TMPDIR:-/tmp}/zero-files-sdk-merged}
pattern=${FILES_SDK_BRANCHES:-'^feat/(files-sdk-|ts-language-gaps|lang-|class-features|binary-data|async-streams|library-types|stdlib-objects|host-globals|plugin-capabilities|static-namespace-members|ts-this-type|php-8\.3)'}

git -C "$repo" fetch origin --quiet --prune
branches=$(git -C "$repo" for-each-ref --sort=committerdate --format='%(refname:lstrip=3)' refs/remotes/origin/ \
  | grep -E "$pattern" || true)

if [ -e "$scratch/.git" ]; then
  git -C "$scratch" merge --abort 2>/dev/null || true
  git -C "$scratch" checkout --quiet --detach origin/main
  git -C "$scratch" reset --quiet --hard origin/main
else
  git -C "$repo" worktree add --quiet --detach "$scratch" origin/main
fi

merged=() conflicts=()
for branch in $branches; do
  sha=$(git -C "$repo" rev-parse --short "origin/$branch")
  pr=$(gh pr list -R spacefast/zero --head "$branch" --state open --json number --jq '.[0].number // empty' 2>/dev/null || true)
  label="$branch@$sha${pr:+ (#$pr)}"
  if git -C "$scratch" merge --quiet --no-edit "origin/$branch" >/dev/null 2>&1; then
    merged+=("$label")
  else
    files=$(git -C "$scratch" diff --name-only --diff-filter=U | paste -sd, - | sed 's/,/, /g')
    git -C "$scratch" merge --abort
    conflicts+=("$label: ${files:-merge failed}")
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
ZERO_BIN="$scratch/target/release/zero" node "$harness/table.mjs" --probes --label "$label" --json "$scratch/files-sdk-table.json"
echo
echo "Merged (oldest first):"
for entry in "${merged[@]}"; do echo "- $entry"; done
[ ${#merged[@]} -eq 0 ] && echo "- none"
echo
echo "Conflicts with the merge so far (left out of this run):"
for entry in "${conflicts[@]}"; do echo "- $entry"; done
[ ${#conflicts[@]} -eq 0 ] && echo "- none"
