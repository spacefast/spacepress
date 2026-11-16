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
scratch=${1:-${TMPDIR:-/tmp}/typedpress-files-sdk-merged}
pattern=${FILES_SDK_BRANCHES:-'^(feat/(files-sdk-|commonjs-|ts-language-gaps|lang-|syntax-|[a-z0-9_-]+-global$|binary-data|async-streams|library-types|stdlib-|class-|host-globals|plugin-capabilities|static-namespace-members|ts-this-type|php-8\.3)|fix/(effects-|fence-))'}

git -C "$repo" fetch origin --quiet --prune
branches=$(git -C "$repo" for-each-ref --sort=committerdate --format='%(refname:lstrip=3)' refs/remotes/origin/ \
  | grep -E "$pattern" || true)

if [ -e "$scratch/.git" ]; then
  # The scratch worktree is this script's own; drop the harness copy from the last run.
  git -C "$scratch" merge --abort 2>/dev/null || true
  git -C "$scratch" reset --quiet --hard
  git -C "$scratch" checkout --quiet --detach origin/main
else
  git -C "$repo" worktree add --quiet --detach "$scratch" origin/main
fi

# Generated docs and the compatibility registry don't change what the compiler does, so a
# conflict only there is resolved by keeping the scratch side; the run lists it.
docs_only='^(docs/language-support\.md|tests/compatibility/registry\.json)$'
merged=() conflicts=() docs_resolved=() broken=()
# A clean text merge can still break the build (two branches changing one type).
# Check after each merge and drop a branch that breaks it, naming the first error.
builds() {
  local log
  if log=$(cargo check --lib --quiet --message-format short --manifest-path "$scratch/Cargo.toml" --target-dir "$scratch/target" 2>&1); then
    return 0
  fi
  grep -m1 -E '^src/.*error' <<<"$log" || grep -m1 error <<<"$log" || echo "cargo check failed"
  return 1
}
already=()
# Squash merges leave the branch outside main's history, so a merged PR whose
# head is the branch's current head also counts as already in main. Without this list every
# squash-merged branch would be measured as unmerged, so a failed lookup stops the run.
listed=false
for attempt in 1 2 3; do
  if merged_heads=$(gh pr list -R spacefast/zero --state merged --base main --limit 2000 --json headRefName,headRefOid \
    --jq '.[] | "\(.headRefName) \(.headRefOid)"'); then
    listed=true
    break
  fi
  [ "$attempt" -lt 3 ] && sleep $((attempt * 10))
done
if ! $listed; then
  echo "files-sdk-merged: could not list merged PRs (gh pr list failed 3 times)" >&2
  exit 1
fi
if [ -z "$merged_heads" ]; then
  echo "files-sdk-merged: gh pr list returned no merged PRs, which can't be right for this repo" >&2
  exit 1
fi
for branch in $branches; do
  sha=$(git -C "$repo" rev-parse --short "origin/$branch")
  full=$(git -C "$repo" rev-parse "origin/$branch")
  if git -C "$repo" merge-base --is-ancestor "origin/$branch" origin/main \
    || grep -qxF "$branch $full" <<<"$merged_heads"; then
    already+=("$branch@$sha")
    continue
  fi
  pr=$(gh pr list -R spacefast/zero --head "$branch" --state open --json number --jq '.[0].number // empty' 2>/dev/null || true)
  label="$branch@$sha${pr:+ (#$pr)}"
  before=$(git -C "$scratch" rev-parse HEAD)
  docs_note=""
  if ! git -C "$scratch" merge --quiet --no-edit "origin/$branch" >/dev/null 2>&1; then
    unmerged=$(git -C "$scratch" diff --name-only --diff-filter=U)
    if [ -n "$unmerged" ] && ! grep -vqE "$docs_only" <<<"$unmerged"; then
      git -C "$scratch" checkout --quiet --ours -- $unmerged
      git -C "$scratch" add -- $unmerged
      git -C "$scratch" commit --quiet --no-edit
      docs_note="$label: $(paste -sd, - <<<"$unmerged" | sed 's/,/, /g')"
    else
      git -C "$scratch" merge --abort
      conflicts+=("$label: $(paste -sd, - <<<"${unmerged:-merge failed}" | sed 's/,/, /g')")
      continue
    fi
  fi
  if error=$(builds); then
    merged+=("$label")
    [ -n "$docs_note" ] && docs_resolved+=("$docs_note")
  else
    git -C "$scratch" reset --quiet --hard "$before"
    broken+=("$label: $error")
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
  if [ -f "$archive" ] && [ ! -f "$harness/.work/${archive##*/}" ]; then cp "$archive" "$harness/.work/"; fi
done

label="merged state: origin/main $(git -C "$repo" rev-parse --short origin/main) + ${#merged[@]} branches, $(date -u +%Y-%m-%dT%H:%MZ)"
TP_BIN="$scratch/target/release/typedpress" node "$harness/table.mjs" --probes --label "$label" --json "$scratch/files-sdk-table.json"
echo
list() {
  local title=$1; shift
  echo "$title"
  if [ $# -eq 0 ]; then echo "- none"; else printf -- '- %s\n' "$@"; fi
  echo
}
list "Merged (oldest first):" "${merged[@]}"
list "Already in origin/main:" "${already[@]}"
list "Merged with generated docs/registry conflicts kept from the scratch side (no compiler effect):" "${docs_resolved[@]}"
list "Text conflicts with the merge so far (left out of this run; owners, please merge origin/main or the conflicting branch):" "${conflicts[@]}"
list "Merged cleanly but broke the build (left out of this run):" "${broken[@]}"
