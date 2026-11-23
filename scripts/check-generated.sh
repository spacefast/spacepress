#!/usr/bin/env bash
# Every example under examples/ that commits files under sp/_generated/ commits what this
# compiler builds. Each one is built again (`spacepress build`, its wp-content into a temporary --out),
# after its committed outputs are deleted, and git must then see no change, deletion or new file
# under its sp/_generated/. That covers the whole client (the copied runtime files, client.js,
# client.d.ts, schema.ts, types.ts), db.d.ts, routes.d.ts and openapi.json, a migration the
# compiler would add, and an output it no longer writes. Committed migrations and plugin locks are
# inputs the build reads, so they are kept: an edit to an existing migration is not caught.
# runtime/client/committed.test.ts checks only the copied client files, without building, on PRs.
#
#   scripts/check-generated.sh [path/to/spacepress]
set -euo pipefail
# Examples must build as users build them: with locales turned off (docs/decisions/2026-11-17-locales-off.md).
unset SPACEPRESS_LOCALES
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
first=$(realpath -- "${1:-target/debug/spacepress}")
[[ -x $first ]] || { echo "no spacepress binary at $first" >&2; exit 2; }
out=$(mktemp -d)
trap 'rm -rf -- "$out"' EXIT

projects=()
while IFS= read -r config; do
	dir=$(dirname "$config")
	[[ -n $(git ls-files -- "$dir/sp/_generated") ]] && projects+=("$dir")
done < <(git ls-files -- 'examples/**/spacepress.config.ts' 'examples/*/spacepress.config.ts' | sort -u)
((${#projects[@]})) || { echo "no example commits sp/_generated/" >&2; exit 2; }

failed=()
for dir in "${projects[@]}"; do
	# An example that reads npm packages as sources installs its locked packages first.
	for lockdir in "$dir" "$(dirname "$dir")"; do
		if [[ -f "$lockdir/package-lock.json" && ! -d "$lockdir/node_modules" && "$lockdir" != examples ]]; then
			npm ci --prefix "$lockdir" --ignore-scripts --no-audit --no-fund --silent
		fi
	done
	# Outputs only: what the build doesn't write again shows as deleted.
	git ls-files -- "$dir/sp/_generated" | { grep -v -e '/migrations/' -e 'lock\.json$' || true; } | while IFS= read -r file; do rm -f -- "$file"; done
	if ! log=$("$first" build "$dir" --out "$out/$dir" --quiet 2>&1); then
		echo "FAIL  $dir: spacepress build failed"
		echo "$log" | sed 's/^/      /'
		failed+=("$dir")
		rm -rf -- "${out:?}/$dir"
		continue
	fi
	rm -rf -- "${out:?}/$dir"
	changes=$(git status --porcelain -- "$dir/sp/_generated")
	if [[ -n $changes ]]; then
		echo "STALE $dir"
		echo "$changes" | sed 's/^/      /'
		failed+=("$dir")
	else
		echo "ok    $dir"
	fi
done

if ((${#failed[@]})); then
	git diff --stat -- "${failed[@]/%//sp/_generated}"
	echo "${#failed[@]} example(s) commit a stale sp/_generated/: run \`spacepress build <dir>\` in ${failed[*]} and commit the result"
	exit 1
fi
