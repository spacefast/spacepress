#!/usr/bin/env node
// Runs evals/guidance/cases.json through `spacepress check --json`.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const bin =
  process.env.SPACEPRESS_BIN ||
  (existsSync(join(repoRoot, "target/release/spacepress"))
    ? join(repoRoot, "target/release/spacepress")
    : join(repoRoot, "target/debug/spacepress"));

if (!existsSync(bin)) {
  console.error(`spacepress binary not found at ${bin}; build it with \`cargo build --release\` or set SPACEPRESS_BIN`);
  process.exit(1);
}

const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
let passed = 0;

for (const c of cases) {
  const dir = mkdtempSync(join(tmpdir(), `sp-eval-${c.id}-`));
  try {
    for (const [rel, content] of Object.entries(c.files)) {
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, "utf8");
    }
    const res = spawnSync(bin, ["check", dir, "--json"], { encoding: "utf8" });
    let report = null;
    try {
      report = JSON.parse(res.stdout);
    } catch {
      console.error(`FAIL ${c.id}: invalid JSON output:\n${res.stdout}\n${res.stderr}`);
      continue;
    }
    const okMatch = Boolean(report.ok) === Boolean(c.expectOk);
    const warnings = [
      ...(report.warnings || []),
      ...(report.diagnostics || []).filter((d) => d.severity === "warning"),
    ];
    const warnMatch = c.expectWarningCode
      ? warnings.some((w) => w.code === c.expectWarningCode || w.rule === c.expectWarningCode)
      : true;

    if (okMatch && warnMatch) {
      passed += 1;
      console.log(`PASS ${c.id}`);
    } else {
      console.error(`FAIL ${c.id}: expected ok=${c.expectOk}${c.expectWarningCode ? ` warning=${c.expectWarningCode}` : ""}, got ok=${report.ok}`, report.diagnostics);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed}/${cases.length} guidance eval cases passed`);
if (passed !== cases.length) process.exit(1);
