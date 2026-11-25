#!/usr/bin/env python3
"""Alternate runtime snapshots on an already provisioned, disposable tests/wp stack."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=Path, required=True, help="baseline runtime/SpacePress snapshot")
    parser.add_argument("--after", type=Path, required=True, help="candidate runtime/SpacePress snapshot")
    parser.add_argument("--content", type=Path, required=True, help="mounted disposable wp-content")
    parser.add_argument("--url", required=True, help="public fixture collection URL")
    parser.add_argument("--rows", type=int, default=25)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--requests", type=int, default=25)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--adapter-before", type=Path, help="optional baseline MCP adapter tree")
    parser.add_argument("--adapter-after", type=Path, help="optional candidate MCP adapter tree")
    parser.add_argument("--mcp-profile", action="store_true", help="separate diagnostic run timing MCP init")
    parser.add_argument("--app-before", type=Path, help="optional baseline app plugin tree")
    parser.add_argument("--app-after", type=Path, help="optional candidate app plugin tree")
    parser.add_argument("--app-slug", help="mounted app plugin directory name")
    parser.add_argument("--body", type=Path, help="POST JSON body; requires --expected")
    parser.add_argument("--expected", type=Path, help="expected decoded JSON response instead of collection validation")
    args = parser.parse_args()
    if bool(args.adapter_before) != bool(args.adapter_after):
        parser.error("both adapter snapshots are required")
    if any([args.app_before, args.app_after, args.app_slug]) and not all([args.app_before, args.app_after, args.app_slug]):
        parser.error("both app snapshots and --app-slug are required")
    if args.app_slug and (Path(args.app_slug).name != args.app_slug or args.app_slug in ['.', '..']):
        parser.error("invalid app slug")
    if args.body and not args.expected:
        parser.error("POST requires --expected")
    here = Path(__file__).resolve().parent
    destination = args.content.resolve() / "plugins/spacepress-runtime/sp"
    for snapshot in [args.before, args.after, destination]:
        if not (snapshot / "bootstrap.php").is_file():
            parser.error(f"not a SpacePress runtime: {snapshot}")
    if min(args.rows, args.runs, args.requests, args.warmup) < 1:
        parser.error("counts must be positive")
    if destination in [args.before.resolve(), args.after.resolve()]:
        parser.error("snapshots must be outside the mounted runtime")

    def harness(*command):
        return subprocess.check_output([str(here / "harness.sh"), *command], text=True)

    def install(snapshot, phase, adapter=None, app=None):
        subprocess.run(["rsync", "-a", "--delete", str(snapshot.resolve()) + "/", str(destination) + "/"], check=True)
        roots = [destination]
        if adapter:
            target = args.content.resolve() / "plugins/mcp-adapter"
            assert (adapter / "mcp-adapter.php").is_file() and adapter.resolve() != target
            subprocess.run(["rsync", "-a", "--delete", str(adapter.resolve()) + "/", str(target) + "/"], check=True)
            roots.append(target)
        if app:
            target = args.content.resolve() / "plugins" / args.app_slug
            assert (app / (args.app_slug + ".php")).is_file() and app.resolve() != target
            subprocess.run(["rsync", "-a", "--delete", str(app.resolve()) + "/", str(target) + "/"], check=True)
            roots.append(target)
        # Distinct old mtimes invalidate Apache's opcache without file_update_protection
        # excluding recently edited files. The harness uses revalidate_freq=0.
        stamp = int(time.time()) - 86400 + phase
        for root in roots:
            for php in root.rglob("*.php"):
                os.utime(php, (stamp, stamp))

    expected_digest = None
    expected = json.loads(args.expected.read_text()) if args.expected else None
    request_body = args.body.read_bytes() if args.body else None

    def request():
        nonlocal expected_digest
        start = time.perf_counter_ns()
        req = urllib.request.Request(args.url, data=request_body, headers={"Content-Type": "application/json"} if request_body else {})
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read()
            elapsed = (time.perf_counter_ns() - start) / 1e6
            metrics = json.loads(response.headers["X-SpacePress-Bench"])
            assert response.status == 200, response.status
        if args.expected:
            assert json.loads(body) == expected, body
        else:
            rows = json.loads(body)["data"]
            assert isinstance(rows, list) and len(rows) == args.rows, rows
            assert all(row["title"] == f"Benchmark {i}" for i, row in enumerate(rows)), rows
        digest = hashlib.sha256(body).hexdigest()
        expected_digest = expected_digest or digest
        assert digest == expected_digest, "response changed between requests or runtime snapshots"
        values = [elapsed, metrics["php_ms"], metrics["peak_bytes"], metrics["allocated_bytes"], metrics["included_files"]]
        if args.mcp_profile:
            values.extend(metrics[name] for name in ["mcp_init_ms", "mcp_init_live_bytes", "mcp_share_percent"])
        return values

    results = {
        "url": args.url, "rows": None if args.expected else args.rows, "warmup_per_phase": args.warmup,
        "columns": ["http_ms", "php_ms", "peak_bytes", "allocated_bytes", "included_files"],
        "runs": [], "errors": 0,
    }
    if args.mcp_profile:
        results["columns"].extend(["mcp_init_ms", "mcp_init_live_bytes", "mcp_share_percent"])
        results["instrumented"] = True
    if args.expected:
        results.update({"method": "POST" if request_body else "GET", "expected_response": expected})
    probe = "/var/www/html/wp-content/mu-plugins/spacepress-runtime-bench.php"
    fixture = "runtime-mcp-metrics.php" if args.mcp_profile else "runtime-metrics.php"
    harness("compose", "cp", str(here / "fixtures" / fixture), "wordpress:" + probe)
    try:
        # The opt-in diagnostic run is separate from uninstrumented latency results.
        for run in range(args.runs):
            for side, snapshot in [("before", args.before), ("after", args.after)]:
                install(snapshot, run * 2 + (side == "after"), args.adapter_before if side == "before" else args.adapter_after,
                        args.app_before if side == "before" else args.app_after)
                for _ in range(args.warmup):
                    request()
                samples = [request() for _ in range(args.requests)]
                medians = [statistics.median(column) for column in zip(*samples)]
                results["runs"].append({"side": side, "samples": samples, "medians": medians})
                print(side, run + 1, json.dumps(medians), flush=True)
        results["response_sha256"] = expected_digest
        results["validated_requests"] = 2 * args.runs * (args.warmup + args.requests)
    except Exception:
        results["errors"] += 1
        raise
    finally:
        install(args.after, 2 * args.runs + 1, args.adapter_after, args.app_after)
        harness("compose", "exec", "-T", "wordpress", "rm", "-f", probe)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    main()
