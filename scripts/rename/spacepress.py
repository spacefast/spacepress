#!/usr/bin/env python3
"""Deterministic brand rename for a git checkout: TypedPress/tp -> SpacePress/sp.

Usage: rename.py <repo> [--apply] [--report <dir>]

Dry run by default: prints a summary, writes per-token reports, and fails on path collisions.
--apply rewrites tracked files in place, moves renamed paths, and stages exactly the touched
paths (forced, literal pathspecs) so .gitignore rules can't drop a tracked file.

Rules (byte-level, ASCII only):
  brand   typedpress/TypedPress/TYPEDPRESS (any case) -> spacepress/SpacePress/SPACEPRESS
  repo    spacefast/zero (not the @spacefast/zero npm scope) -> spacefast/spacepress
  short   tp/TP/Tp as a prefix or word -> sp/SP/Sp; camelCase tpFoo -> spFoo; tpv/tpapp/tpswap
Scopes:
  generated build output (runtime/admin/build, runtime/identity/build) is skipped: rebuilt after.
  vendored code (vendor-prefixed, the legacy Zero client) and lockfiles get the brand rule only.
  upstream metadata other than our adapter-originals is left alone; its inventory is rehashed after.
"""
from collections import Counter, defaultdict
from pathlib import Path
import os
import re
import subprocess
import sys

BRAND = re.compile(rb"typedpress", re.I)
BRAND_CASE = {b"TYPEDPRESS": b"SPACEPRESS", b"TypedPress": b"SpacePress", b"typedpress": b"spacepress"}
REPO = re.compile(rb"(?<![@\w.-])spacefast/zero(?![\w-])")
# tp / TP / Tp at a word start. Lowercase `tp` takes a following non-alphanumeric (tp_, tp/, tp-, tp.,
# tp", end) or a capitalized word (camelCase: tpLoader) unless it sits in base64 (+ or / before it).
SHORT = re.compile(
    rb"(?<![A-Za-z0-9])(?:"
    rb"tp(?![A-Za-z0-9])"
    rb"|(?<![+/])tp(?=[A-Z][a-z])"
    rb"|TP(?![A-Za-z0-9])"
    rb"|Tp(?=[A-Z_])"
    rb"|(?:tpv|tpapp|tpswap)(?![A-Za-z0-9])"
    rb")"
)
VENDOR_SHORT = re.compile(rb"(?<![A-Za-z0-9])(?:TP(?=_(?:IDENTITY_)?VENDOR_)|(?<=_)tp(?=_(?:runtime|identity)_vendor_))")

SKIP_PREFIXES = ("runtime/admin/build/", "runtime/identity/build/")
BRAND_ONLY = re.compile(r"(^|/)vendor-prefixed/|^migrate/src/zero/client08/|^crates/oxc-browserslist/src/|(^|/)(package-lock\.json|pnpm-lock\.yaml|bun\.lock|Cargo\.lock|composer\.lock)$")
UPSTREAM = re.compile(r"^runtime/admin/upstream-metadata/(?!adapter-originals/)|^runtime/admin/upstream-inventory\.json$")
# Exact spots where `tp` is not this project's prefix: another repository's file name, or a test that
# feeds an arbitrary string to a parser.
KEEP = (b"stattic-runtime-core/src/tp.rs",)


def scope(path: str) -> str:
    if path.startswith(SKIP_PREFIXES):
        return "skip"
    if UPSTREAM.search(path):
        return "upstream"
    if BRAND_ONLY.search(path):
        return "vendor"
    return "own"


def brand(data: bytes) -> bytes:
    return BRAND.sub(lambda m: BRAND_CASE.get(m[0], b"SpacePress" if m[0][:1].isupper() else b"spacepress"), data)


def short(m: re.Match) -> bytes:
    t = m[0]
    return (b"SP" if t[:2] == b"TP" else b"Sp" if t[:2] == b"Tp" else b"sp") + t[2:]


def rewrite(data: bytes, kind: str, counts: Counter | None = None) -> bytes:
    if kind in ("skip", "upstream"):
        return data
    out = brand(data)
    out = REPO.sub(b"spacefast/spacepress", out)
    pattern = SHORT if kind == "own" else VENDOR_SHORT
    if counts is not None:
        for m in pattern.finditer(out):
            end = m.end()
            tail = re.match(rb"[A-Za-z0-9_./:-]{0,24}", out[end:])[0]
            counts[(m[0] + tail).decode("latin1")] += 1
    return protect(out, lambda part: pattern.sub(short, part))


def protect(data: bytes, fn) -> bytes:
    pieces = re.split(b"(" + b"|".join(re.escape(k) for k in KEEP) + b")", data)
    return b"".join(p if p in KEEP else fn(p) for p in pieces)


def rename_path(path: str) -> str:
    kind = scope(path)
    if kind == "upstream":
        return path
    if kind == "skip":
        kind = "own"
    return "/".join(rewrite(part.encode(), kind).decode() for part in path.split("/"))


def main() -> None:
    repo = Path(sys.argv[1]).resolve()
    apply = "--apply" in sys.argv
    report = Path(sys.argv[sys.argv.index("--report") + 1]) if "--report" in sys.argv else None
    tracked = [p for p in subprocess.check_output(["git", "-C", str(repo), "ls-files", "-z"]).decode().split("\0") if p]
    modes = {}
    for line in subprocess.check_output(["git", "-C", str(repo), "ls-files", "-s", "-z"]).decode().split("\0"):
        if line:
            meta, path = line.split("\t", 1)
            modes[path] = meta.split()[0]
    moves, edits = {}, {}
    counts: Counter = Counter()
    files_per_token = defaultdict(set)
    for path in tracked:
        target = rename_path(path)
        if target != path:
            moves[path] = target
        if modes[path] == "120000" or scope(path) in ("skip", "upstream"):
            continue
        file = repo / path
        data = file.read_bytes()
        if b"\0" in data:
            continue
        local: Counter = Counter()
        revised = rewrite(data, scope(path), local)
        for token in local:
            files_per_token[token].add(path)
        counts.update(local)
        if revised != data:
            edits[path] = revised
    destinations = defaultdict(list)
    for path in tracked:
        destinations[moves.get(path, path).casefold()].append(path)
    collisions = [paths for paths in destinations.values() if len(paths) > 1]
    print(f"tracked={len(tracked)} content_edits={len(edits)} path_moves={len(moves)} collisions={len(collisions)}")
    for paths in collisions:
        print("COLLISION", paths)
    if report:
        report.mkdir(parents=True, exist_ok=True)
        with open(report / "short-tokens.tsv", "w") as out:
            for token, n in counts.most_common():
                files = sorted(files_per_token[token])
                out.write(f"{n}\t{token}\t{len(files)}\t{' '.join(files[:3])}\n")
        with open(report / "moves.tsv", "w") as out:
            for a, b in sorted(moves.items()):
                out.write(f"{a}\t{b}\n")
        with open(report / "edits.txt", "w") as out:
            out.write("\n".join(sorted(edits)) + "\n")
    if collisions:
        raise SystemExit(1)
    if not apply:
        return
    for path, data in edits.items():
        (repo / path).write_bytes(data)
    for path, target in moves.items():
        dest = repo / target
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.rename(repo / path, dest)
    for path in moves:
        parent = (repo / path).parent
        while parent != repo and parent.exists() and not any(parent.iterdir()):
            parent.rmdir()
            parent = parent.parent
    env = {**os.environ, "GIT_LITERAL_PATHSPECS": "1"}
    old = "\0".join(moves) + "\0"
    new = "\0".join(sorted(set(moves.values()) | (set(edits) - set(moves)))) + "\0"
    subprocess.run(["git", "-C", str(repo), "rm", "-q", "--cached", "--pathspec-from-file=-", "--pathspec-file-nul"], input=old.encode(), check=True, env=env)
    subprocess.run(["git", "-C", str(repo), "add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], input=new.encode(), check=True, env=env)


if __name__ == "__main__":
    main()
