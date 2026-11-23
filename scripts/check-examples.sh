#!/usr/bin/env bash
# Every app under examples/ must compile: `spacepress check` on each directory that holds a
# spacepress.config.ts. An example that reads npm packages as sources has a package-lock.json in its
# own directory or the one above it; its locked packages are installed first, as its README says.
#
# examples/files-sdk is left out: it is a probe that compiles a whole published npm package and
# records what does not compile yet (its own harness, verify.mjs, compares PHP with Node).
#
#   scripts/check-examples.sh [path/to/first]
set -euo pipefail
# Examples must build as users build them: with locales turned off (docs/decisions/2026-11-17-locales-off.md).
unset SPACEPRESS_LOCALES
first=${1:-target/debug/spacepress}
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

failed=()
while IFS= read -r config; do
	dir=$(dirname "$config")
	for lockdir in "$dir" "$(dirname "$dir")"; do
		if [[ -f "$lockdir/package-lock.json" && ! -d "$lockdir/node_modules" && "$lockdir" != examples ]]; then
			npm ci --prefix "$lockdir" --ignore-scripts --no-audit --no-fund --silent
		fi
	done
	if out=$("$first" check "$dir" 2>&1); then
		echo "ok    $dir"
	else
		echo "FAIL  $dir"
		echo "$out" | sed 's/^/      /'
		failed+=("$dir")
	fi
done < <(find examples -name spacepress.config.ts -not -path '*/node_modules/*' -not -path 'examples/files-sdk/*' | sort)

if ((${#failed[@]})); then
	echo "${#failed[@]} example(s) do not compile: ${failed[*]}"
	exit 1
fi
