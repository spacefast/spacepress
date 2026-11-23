#!/usr/bin/env python3
"""Deterministic brand rename for a git checkout: TypedPress/tp -> SpacePress/sp.

Usage: spacepress.py <repo> [--apply] [--report <dir>]

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
from argparse import ArgumentParser
from collections import Counter, defaultdict
from pathlib import Path
import os
import re
import subprocess

BRAND = re.compile(rb"typedpress", re.I)
BRAND_CASE = {b"TYPEDPRESS": b"SPACEPRESS", b"TypedPress": b"SpacePress", b"typedpress": b"spacepress"}
REPO = re.compile(rb"(?<![@\w.-])spacefast/zero(?![\w-])")
# tp / TP / Tp at a word start. Lowercase `tp` takes a following non-alphanumeric (tp_, tp/, tp-, tp.,
# tp", end) or a capitalized word (camelCase: tpLoader). Base64 and hashes are masked first (ENCODED, OPAQUE).
SHORT = re.compile(
    # A regex anchor (`\Atp_`) counts as a word start too.
    rb"(?:(?<![A-Za-z0-9])|(?<=\\A))(?:"
    rb"tp(?![A-Za-z0-9])"
    rb"|tp(?=[A-Z][a-z])"
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
    pattern = SHORT if kind == "own" else VENDOR_SHORT

    def rename(part: bytes) -> bytes:
        out = REPO.sub(b"spacefast/spacepress", brand(part))
        if counts is not None:
            for m in pattern.finditer(out):
                end = m.end()
                tail = re.match(rb"[A-Za-z0-9_./:-]{0,24}", out[end:])[0]
                counts[(m[0] + tail).decode("latin1")] += 1
        return protect(out, OPAQUE, lambda rest: pattern.sub(short, rest))

    return protect(data, ENCODED, rename)


# Where encoded data sits, whatever its shape, so no rule applies: integrity values (`sha512-…`), a
# data URI's payload and a source map's mappings. (Unpadded base64 like `AAAA/tp/Z999` has a path's
# shape; only its place tells it apart.) An external `sourceMappingURL` is a path: it follows the file.
ENCODED = re.compile(
    rb"\bsha(?:1|256|384|512)-[A-Za-z0-9+/]+={0,2}"
    rb"|;base64,[A-Za-z0-9+/]+={0,2}"
    rb'|"mappings"\s*:\s*"[^"]*"'
)
# Shapes of encoded data, where only the short rule must not apply (a long identifier that holds a
# digit still takes the brand): padded base64, and runs of 24+ base64 characters with no path or
# identifier shape (no `_`, `-` or `.`, and at least one digit or `+`, and not only `/`-separated
# words). A path like `wp/v2/tp_posts` or `tp/v1/actions/capacityReport` has none of these shapes.
OPAQUE = re.compile(
    rb"(" + rb"|".join(re.escape(k) for k in KEEP) + rb")"
    rb"|(?<![A-Za-z0-9+/=_.-])[A-Za-z0-9+/]{4,}={1,2}(?![A-Za-z0-9+/=])"
    rb"|(?<![A-Za-z0-9+/=_.-])(?=[A-Za-z0-9+/]*[0-9+])(?![A-Za-z0-9]*(?:/[A-Za-z0-9]+)+(?![A-Za-z0-9+/]))[A-Za-z0-9+/]{24,}(?![A-Za-z0-9+/=_.-])"
    # Unpadded base64 with a `+` in it, 8+ characters long and a whole number of 4-character blocks:
    # a path or identifier never has a `+`.
    rb"|(?<![A-Za-z0-9+/=_.-])(?=[A-Za-z0-9+/]*\+)(?:[A-Za-z0-9+/]{4}){2,}(?![A-Za-z0-9+/=_.-])"
    rb"|[0-9a-fA-F]{32,}"
)


def protect(data: bytes, mask: re.Pattern, fn) -> bytes:
    out, last = [], 0
    for m in mask.finditer(data):
        out += [fn(data[last:m.start()]), m[0]]
        last = m.end()
    return b"".join(out) + fn(data[last:])


# A migration's directory name is its ID: the site's ledger records it. It and the `"id"` in its
# ops.json stay as written, so an applied migration is still applied after the rename.
MIGRATION_ID = re.compile(r"^\d{14}_[0-9a-z]{6}_[A-Za-z0-9_-]+$")


def migration_id(parts: list[str], i: int) -> bool:
    return i > 0 and parts[i - 1] == "migrations" and MIGRATION_ID.match(parts[i]) is not None


def rename_path(path: str) -> str:
    kind = scope(path)
    if kind == "upstream":
        return path
    if kind == "skip":
        kind = "own"
    parts = path.split("/")
    return "/".join(part if migration_id(parts, i) else rewrite(part.encode(), kind).decode() for i, part in enumerate(parts))


def rewrite_file(path: str, data: bytes, kind: str, counts: Counter | None = None) -> bytes:
    parts = path.split("/")
    if len(parts) >= 2 and parts[-1] == "ops.json" and migration_id(parts, len(parts) - 2):
        ident = parts[-2].encode()
        marker = b"\0MIGRATION-ID\0"
        return rewrite(data.replace(ident, marker), kind, counts).replace(marker, ident)
    return rewrite(data, kind, counts)


def main() -> None:
    parser = ArgumentParser(description="Rename the tracked source of a SpacePress project.")
    parser.add_argument("repo", type=Path)
    parser.add_argument("--apply", action="store_true", help="write and stage the rename")
    parser.add_argument("--report", type=Path, help="write detailed scope reports to this directory")
    arguments = parser.parse_args()
    repo = arguments.repo.resolve()
    report = arguments.report
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
        revised = rewrite_file(path, data, scope(path), local)
        for token in local:
            files_per_token[token].add(path)
        counts.update(local)
        if revised != data:
            edits[path] = revised
    destinations = defaultdict(list)
    for path in tracked:
        destinations[moves.get(path, path).casefold()].append(path)
    collisions = [paths for paths in destinations.values() if len(paths) > 1]
    blocked = []
    for target in sorted(moves.values()):
        destination = repo / target
        if os.path.lexists(destination) or any(
            parent.is_symlink() or (parent.exists() and not parent.is_dir())
            for parent in destination.parents
            if parent.is_relative_to(repo) and parent != repo
        ):
            blocked.append(target)
    print(f"tracked={len(tracked)} content_edits={len(edits)} path_moves={len(moves)} collisions={len(collisions) + len(blocked)}")
    for paths in collisions:
        print("COLLISION", paths)
    for target in blocked:
        print("DESTINATION EXISTS OR IS BLOCKED", target)
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
    if collisions or blocked:
        raise SystemExit(1)
    if not arguments.apply or (not moves and not edits):
        return
    git = ["git", "-C", str(repo)]
    if subprocess.run([*git, "diff", "--cached", "--quiet"]).returncode:
        raise SystemExit("Commit your staged changes before applying the rename.")
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
    new = "\0".join(sorted(set(moves.values()) | (set(edits) - set(moves)))) + "\0"
    if moves:
        old = "\0".join(moves) + "\0"
        subprocess.run([*git, "rm", "-q", "--cached", "--pathspec-from-file=-", "--pathspec-file-nul"], input=old.encode(), check=True, env=env)
    subprocess.run([*git, "add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], input=new.encode(), check=True, env=env)


if __name__ == "__main__":
    main()
