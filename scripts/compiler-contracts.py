#!/usr/bin/env python3
"""Generate/check the documented, fixture-backed compiler compatibility inventory."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "tests/compatibility/registry.json"
OUTPUT = ROOT / "docs/language-support.md"


def render():
    registry = json.loads(REGISTRY.read_text())
    assert registry["version"] == 1
    ids = set()
    lines = [
        "# Tested compiler compatibility", "",
        "Generated from `tests/compatibility/registry.json`; run `python3 scripts/compiler-contracts.py` to update.", "",
        "This is a growing evidence inventory, not an exhaustive language specification. Refusals are verified by running",
        "`first check --json` on each registered fixture in `tests/compiler_contracts.rs`. Supported behavior and intentional",
        "differences link to their executable evidence. A silent, undocumented mismatch is a bug, not an exclusion.", "",
        "String semantics here describe the current implementation; changes require updating the evidence and this registry.", "",
    ]
    for entry in registry["entries"]:
        identity = entry["id"]
        assert identity not in ids, f"duplicate ID: {identity}"
        ids.add(identity)
        status = entry["status"]
        assert status in {"refused", "divergence", "supported"}
        evidence = entry["fixture"] if status == "refused" else entry["evidence"]
        assert (ROOT / evidence).exists(), f"missing evidence: {evidence}"
        if status == "refused":
            assert (ROOT / evidence / "first.config.ts").is_file()
            assert entry["code"].startswith("Z") and entry["message"]
        if status != "refused":
            test = entry["test"]
            assert re.search(r"\n\s*fn " + re.escape(test) + r"\(", (ROOT / evidence).read_text()), f"missing test: {test}"
        lines += [f"## {identity}", "", f"Status: **{status}**." + (f" Diagnostic: `{entry['code']}`." if status == "refused" else ""),
                  "", entry["guidance"], "", f"[Evidence](../{evidence})" + (f" (`{entry['test']}`)" if status != "refused" else ""), ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != expected:
            parser.exit(1, "language-support.md is stale; run python3 scripts/compiler-contracts.py\n")
    else:
        OUTPUT.write_text(expected)


if __name__ == "__main__":
    main()
