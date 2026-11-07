#!/usr/bin/env python3
"""Count `zero migrate app --from zero-0.8` outcomes over a corpus of 0.8 projects.

Usage: scripts/migrate-census.py [--zero target/debug/zero] [--json] [--flag <converter flag>]... [corpus-dir ...]

An app is a 0.8 project directory, or a stored finalize payload: a directory with
`finalize.json` (the `{ artifact, endpointSources }` a 0.8 publish kept) and, when the
published source was recovered, a `source/` directory beside it. Such an app runs as
`zero migrate app --from zero-0.8 --manifest finalize.json [source]`; without `source/`
it is refused at `/source` ("source not recoverable"), never accepted.

The default corpus is tests/fixtures/app-migrate/corpus: 0.8 projects copied from
spacefast/monorepo (see its README). The purpose-built converter fixtures beside it are not
counted, so the census does not grade the converter on its own tests. Each immediate
subdirectory is one 0.8 project.

Formula (the same one docs/zero-08-parity.md reports):
  accepted(app)   = the dry run exits 0 with status "dry-run"
  refused(app)    = not accepted
  category(error) = the first rule in CATEGORIES whose pattern matches the error pointer
                    (the reason text for pointer-less errors)
  count(category) = number of refused apps with at least one error in that category
Each app is counted once per category, so category counts can sum to more than the
number of refused apps. An app may carry `census.json` with `{"flags": [...]}`, the
converter flags its Space needs (for example `--users` when Space Users is on).
"""
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = [os.path.join(ROOT, "tests/fixtures/app-migrate/corpus")]

# Ordered: the first match wins.
CATEGORIES = [
    # A manifest app whose source is missing, or differs from the published hashes.
    ("source", r"^/source$"),
    ("pages", r"^/(pages|layouts|islands)(/|$)"),
    ("endpoints", r"^/endpoints(/|$)"),
    ("auth-callbacks", r"^/auth/"),
    ("auth-identity", r"/ctx/auth(/|$)"),
    ("db-builder", r"/ctx/db(/|$)"),
    ("context-service", r"/ctx(/|$)"),
    ("native-content", r"^/collections/(pages|media)(/|$)"),
    ("content", r"^/(collections|sync)(/|$)"),
    ("schema", r"^/schema(/|$)"),
    ("handlers", r"^/(queries|mutations|actions)(/|$)"),
    ("capsule-option", r"^/[^/]+$"),
]
REASON_CATEGORIES = [
    ("server-jsx", r"uses JSX on the server"),
    ("source-entry", r"server/index\.ts|cannot read capsule source|finalize payload|server entry"),
    ("npm-import", r"needs a manual port; only local TypeScript"),
    ("build-global", r"names a build-time global"),
    # A helper the app copies verbatim uses JavaScript the v2 subset does not compile.
    ("v2-language", r"^error: .*(isn't supported|doesn't support|isn't defined)"),
    ("v2-compile", r"refused by v2 compiler"),
]


def category(error):
    pointer, reason = error.get("pointer", ""), error.get("reason", "")
    if pointer:
        for name, pattern in CATEGORIES:
            if re.search(pattern, pointer):
                return name
    for name, pattern in REASON_CATEGORIES:
        if re.search(pattern, reason):
            return name
    return "other"


def projects(paths):
    for path in paths:
        if (os.path.isdir(os.path.join(path, "server")) or os.path.exists(os.path.join(path, "sf.jsonc"))
                or os.path.exists(os.path.join(path, "finalize.json"))):
            yield path
            continue
        for name in sorted(os.listdir(path)):
            child = os.path.join(path, name)
            if os.path.isdir(child):
                yield child


def flags(project):
    path = os.path.join(project, "census.json")
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return list(json.load(f).get("flags", []))


def run(zero, project, scratch, extra):
    out = os.path.join(scratch, os.path.basename(project))
    manifest = os.path.join(project, "finalize.json")
    if os.path.exists(manifest):
        source = os.path.join(project, "source")
        inputs = ["--manifest", manifest, *([source] if os.path.isdir(source) else [])]
    else:
        inputs = [project]
    proc = subprocess.run(
        [zero, "migrate", "app", "--from", "zero-0.8", *inputs, "--out", out,
         "--space", "spc_census", "--dry-run", "--json", *sorted(set(flags(project) + extra))],
        capture_output=True, text=True,
    )
    try:
        report = json.loads(proc.stdout)
    except json.JSONDecodeError:
        report = {"status": "crashed", "errors": [{"pointer": "", "reason": proc.stderr.strip()[:300]}]}
    return report


def main(argv):
    zero = os.path.join(ROOT, "target/debug/zero")
    as_json = False
    extra = []
    paths = []
    it = iter(argv)
    for arg in it:
        if arg == "--zero":
            zero = next(it)
        elif arg == "--json":
            as_json = True
        elif arg == "--flag":
            extra.append(next(it))
        else:
            paths.append(os.path.abspath(arg))
    apps = []
    with tempfile.TemporaryDirectory() as scratch:
        for project in projects(paths or DEFAULT):
            report = run(zero, project, scratch, extra)
            errors = report.get("errors", [])
            cats = sorted({category(e) for e in errors})
            apps.append({
                "app": os.path.relpath(project, ROOT),
                "accepted": report.get("status") == "dry-run",
                "categories": cats,
                "errors": [{"pointer": e.get("pointer", ""), "category": category(e)} for e in errors],
            })
    refused = [a for a in apps if not a["accepted"]]
    counts = {}
    for a in refused:
        for c in a["categories"]:
            counts[c] = counts.get(c, 0) + 1
    only = lambda want: sum(1 for a in refused if set(a["categories"]) & {"pages", "endpoints"} == want)
    summary = {
        "flags": extra,
        "apps": len(apps),
        "accepted": len(apps) - len(refused),
        "refused": len(refused),
        "refusedBy": dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))),
        "pagesOnly": only({"pages"}),
        "endpointsOnly": only({"endpoints"}),
        "pagesAndEndpoints": only({"pages", "endpoints"}),
        "perApp": apps,
    }
    if as_json:
        print(json.dumps(summary, indent=2))
        return
    print(f"apps {summary['apps']}  accepted {summary['accepted']}  refused {summary['refused']}")
    for c, n in summary["refusedBy"].items():
        print(f"  {c:16} {n}")
    print(f"  pages-only {summary['pagesOnly']}  endpoints-only {summary['endpointsOnly']}  both {summary['pagesAndEndpoints']}")
    for a in apps:
        mark = "accepted" if a["accepted"] else "refused: " + ", ".join(a["categories"])
        print(f"{a['app']}: {mark}")


if __name__ == "__main__":
    main(sys.argv[1:])
