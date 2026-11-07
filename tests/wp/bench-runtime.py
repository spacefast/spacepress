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
    parser.add_argument("--before", type=Path, required=True, help="baseline runtime/Zero snapshot")
    parser.add_argument("--after", type=Path, required=True, help="candidate runtime/Zero snapshot")
    parser.add_argument("--content", type=Path, required=True, help="mounted disposable wp-content")
    parser.add_argument("--url", required=True, help="public fixture collection URL")
    parser.add_argument("--rows", type=int, default=25)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--requests", type=int, default=25)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    destination = args.content.resolve() / "plugins/zero-runtime/zero"
    for snapshot in [args.before, args.after, destination]:
        if not (snapshot / "bootstrap.php").is_file():
            parser.error(f"not a Zero runtime: {snapshot}")
    if min(args.rows, args.runs, args.requests, args.warmup) < 1:
        parser.error("counts must be positive")
    if destination in [args.before.resolve(), args.after.resolve()]:
        parser.error("snapshots must be outside the mounted runtime")

    def harness(*command):
        return subprocess.check_output([str(here / "harness.sh"), *command], text=True)

    def install(snapshot, phase):
        subprocess.run(["rsync", "-a", "--delete", str(snapshot.resolve()) + "/", str(destination) + "/"], check=True)
        # Distinct old mtimes invalidate Apache's opcache without file_update_protection
        # excluding recently edited files. The harness uses revalidate_freq=0.
        stamp = int(time.time()) - 86400 + phase
        for php in destination.rglob("*.php"):
            os.utime(php, (stamp, stamp))

    expected_digest = None

    def request():
        nonlocal expected_digest
        start = time.perf_counter_ns()
        with urllib.request.urlopen(args.url, timeout=30) as response:
            body = response.read()
            elapsed = (time.perf_counter_ns() - start) / 1e6
            metrics = json.loads(response.headers["X-Zero-Bench"])
            assert response.status == 200, response.status
        rows = json.loads(body)["data"]
        assert isinstance(rows, list) and len(rows) == args.rows, rows
        assert all(row["title"] == f"Benchmark {i}" for i, row in enumerate(rows)), rows
        digest = hashlib.sha256(body).hexdigest()
        expected_digest = expected_digest or digest
        assert digest == expected_digest, "response changed between requests or runtime snapshots"
        return [elapsed, metrics["php_ms"], metrics["peak_bytes"], metrics["allocated_bytes"], metrics["included_files"]]

    results = {
        "url": args.url, "rows": args.rows, "warmup_per_phase": args.warmup,
        "columns": ["http_ms", "php_ms", "peak_bytes", "allocated_bytes", "included_files"],
        "runs": [], "errors": 0,
    }
    probe = "/var/www/html/wp-content/mu-plugins/zero-runtime-bench.php"
    harness("compose", "cp", str(here / "fixtures/runtime-metrics.php"), "wordpress:" + probe)
    try:
        # Profilers must be removed before this measurement.
        for run in range(args.runs):
            for side, snapshot in [("before", args.before), ("after", args.after)]:
                install(snapshot, run * 2 + (side == "after"))
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
        install(args.after, 2 * args.runs + 1)
        harness("compose", "exec", "-T", "wordpress", "rm", "-f", probe)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    main()
