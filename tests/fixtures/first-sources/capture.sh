#!/usr/bin/env bash
# Captures one fixture set of the kept-source suite (README.md): for each example, the source bundle
# `first sources` writes and the baseline `first compile-sources` leaves (snapshot, migrations,
# storage.json), with the compiler built from the commit checked out at the repository root.
#
#   tests/fixtures/first-sources/capture.sh <label>          # e.g. head
#
# Until the first release is tagged, a PR that deliberately changes what the authoring surface accepts
# reruns this for `head` and adds a row to the README's table of breaks. A release adds its own label,
# captured once and never again.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
label="${1:?usage: capture.sh <label>}"
cd "$repo"
cargo build -q --bin first
first="${CARGO_TARGET_DIR:-target}/debug/first"
[[ $first == /* ]] || first="$repo/$first"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
rm -rf "${here:?}/$label"
for app in pantry blog full-site; do
  out="$here/$label/$app"
  mkdir -p "$out"
  "$first" sources "examples/$app" --out "$out/sources" >/dev/null
  "$first" compile-sources "$out/sources" "$work/$app" "$out/sources" >/dev/null
  mkdir -p "$out/baseline"
  cp -r "$work/$app/migrations" "$out/baseline/migrations"
  cp "$work/$app/snapshot.json" "$work/$app/storage.json" "$out/baseline/"
  # What recompiling the capture against its own baseline plans: no new migration, normally.
  "$first" compile-sources "$out/sources" "$work/$app-again" "$out/sources" "$work/$app" >/dev/null
  python3 - "$work/$app/migrations" "$work/$app-again/migrations" > "$out/plan.json" <<'PY'
import json,os,sys
before=set(os.listdir(sys.argv[1])); after=sorted(os.listdir(sys.argv[2]))
print(json.dumps([{"file":f,"sql":open(os.path.join(sys.argv[2],f)).read()} for f in after if f not in before], indent=1))
PY
done
echo "captured $label at $(git rev-parse --short HEAD)"
