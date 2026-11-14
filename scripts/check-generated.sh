#!/usr/bin/env bash
# Every example that commits its generated client commits what this compiler builds: `first build`
# on each one, then no change (or new file) under its first/_generated/. That covers the whole
# client (the copied runtime files, client.js, client.d.ts, schema.ts, types.ts), and the
# migrations, openapi.json and declarations committed beside it.
# runtime/client/committed.test.ts checks only the copied files, without building, on every PR.
#
#   scripts/check-generated.sh [path/to/first]
set -euo pipefail
first=$(realpath "${1:-target/debug/first}")
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
out=$(mktemp -d)
trap 'rm -rf -- "$out"' EXIT

projects=()
while IFS= read -r client; do
	projects+=("${client%/first/_generated/client/index.ts}")
done < <(git ls-files -- ':(glob)**/first/_generated/client/index.ts')
((${#projects[@]})) || { echo "no committed first/_generated/client/ found" >&2; exit 1; }

failed=()
for dir in "${projects[@]}"; do
	# An example that reads npm packages as sources installs its locked packages first.
	for lockdir in "$dir" "$(dirname "$dir")"; do
		if [[ -f "$lockdir/package-lock.json" && ! -d "$lockdir/node_modules" && "$lockdir" != examples ]]; then
			npm ci --prefix "$lockdir" --ignore-scripts --no-audit --no-fund --silent
		fi
	done
	if ! log=$("$first" build "$dir" --out "$out/$dir" --quiet 2>&1); then
		echo "FAIL  $dir: first build failed"
		echo "$log" | sed 's/^/      /'
		failed+=("$dir")
	elif changes=$(git status --porcelain -- "$dir/first/_generated") && [[ -n $changes ]]; then
		echo "STALE $dir"
		echo "$changes" | sed 's/^/      /'
		failed+=("$dir")
	else
		echo "ok    $dir"
	fi
done

if ((${#failed[@]})); then
	git diff --stat -- "${failed[@]/%//first/_generated}"
	echo "${#failed[@]} example(s) commit a stale first/_generated/: run \`first build <dir>\` in ${failed[*]} and commit the result"
	exit 1
fi
