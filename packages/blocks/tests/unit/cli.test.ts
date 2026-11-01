import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { main } from "../../src/cli.ts";
import { fixture } from "./helpers.ts";

function run(argv: string[]) {
  let stdout = "";
  let stderr = "";
  return main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) }).then((code) => ({ code, stdout, stderr }));
}

function withDir<T>(use: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "zero-blocks-cli-"));
  return use(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("content writes the markup to --out with a trailing newline and exits 0", () =>
  withDir(async (dir) => {
    const out = path.join(dir, "pricing.html");
    const ok = await run(["content", fixture("pricing.tsx"), "--out", out]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(ok.stdout, "");
    const written = readFileSync(out, "utf8");
    assert.match(written, /^<!-- wp:heading/);
    assert.ok(written.endsWith("-->\n"));
  }));

test("without --out the markup goes to stdout", async () => {
  const ok = await run(["content", fixture("pricing.tsx")]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /^<!-- wp:heading/);
});

test("an error prints file:line:col diagnostics relative to the cwd, exits 1, and writes nothing", () =>
  withDir(async (dir) => {
    const bad = await run(["content", fixture("styled.tsx"), "--out", path.join(dir, "styled.html")]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /(^|\n)tests\/unit\/fixtures\/styled\.tsx:5:7 style_prop_unsupported: /);
    assert.deepEqual(readdirSync(dir), []);
  }));

test("--json prints the diagnostics as JSON", async () => {
  const json = await run(["content", fixture("styled.tsx"), "--json"]);
  assert.equal(json.code, 1);
  const parsed = JSON.parse(json.stderr) as { code: string; line: number; column: number; file: string }[];
  assert.deepEqual(parsed.map((d) => [d.code, d.file, d.line, d.column]), [["style_prop_unsupported", "tests/unit/fixtures/styled.tsx", 5, 7], ["unmappable_element", "tests/unit/fixtures/styled.tsx", 6, 9]]);
});

test("info diagnostics (an unverified third-party block) show only with --verbose", async () => {
  const quiet = await run(["content", fixture("pricing.tsx")]);
  assert.equal(quiet.stderr, "");
  const verbose = await run(["content", fixture("pricing.tsx"), "--verbose"]);
  assert.match(verbose.stderr, /unverified_block: acme\/testimonials/);
});

test("a missing command or file exits 2 with the usage text", async () => {
  const none = await run([]);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /^usage:/);
  assert.equal((await run(["content"])).code, 2);
});

test("an unknown flag exits 2 and names the flag", async () => {
  const unknown = await run(["content", "x.tsx", "--nope"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown flag --nope/);
});

test("--out followed by another flag has no path: exit 2 and no file named after the flag", () =>
  withDir(async (dir) => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const missing = await run(["content", fixture("pricing.tsx"), "--out", "--json"]);
      assert.equal(missing.code, 2);
      assert.match(missing.stderr, /--out needs a path/);
      assert.deepEqual(readdirSync(dir), []);
    } finally {
      process.chdir(cwd);
    }
  }));

test("a diagnostic from inside a component prints where the component was used", async () => {
  const text = await run(["content", fixture("uses-card.tsx")]);
  assert.match(text.stderr, /card\.tsx:3:10 style_prop_unsupported: .* \(used at tests\/unit\/fixtures\/uses-card\.tsx:7:7\)/);
});

test("the JSON report carries the component's call site as usedAt", async () => {
  const json = await run(["content", fixture("uses-card.tsx"), "--json"]);
  assert.deepEqual((JSON.parse(json.stderr) as { usedAt: unknown }[])[0]!.usedAt, { file: "tests/unit/fixtures/uses-card.tsx", line: 7, column: 7 });
});

test("build writes <out>/<slug> and prints what it wrote", () =>
  withDir(async (dir) => {
    const ok = await run(["build", fixture("theme"), "--out", dir]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /fixture-theme\/ \(17 files\)/);
    assert.deepEqual(readdirSync(path.join(dir, "fixture-theme")).sort(), ["assets", "parts", "patterns", "readme.txt", "screenshot.png", "style.css", "styles", "templates", "theme.json"]);
    assert.match(ok.stderr, /unused_part/);
  }));

test("build --zip also writes <out>/<slug>.zip", () =>
  withDir(async (dir) => {
    const ok = await run(["build", fixture("theme"), "--out", dir, "--zip"]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.ok(readdirSync(dir).includes("fixture-theme.zip"));
    assert.match(ok.stdout, /fixture-theme\.zip/);
  }));

test("check reports the diagnostics a build would and writes nothing", () =>
  withDir(async (dir) => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const ok = await run(["check", fixture("theme")]);
      assert.equal(ok.code, 0, ok.stderr);
      assert.match(ok.stderr, /unused_part/);
      assert.deepEqual(readdirSync(dir), []);
    } finally {
      process.chdir(cwd);
    }
  }));

test("a theme with an error exits 1 from build and check, with file:line:col, and build writes nothing", () =>
  withDir(async (dir) => {
    const theme = path.join(dir, "broken");
    const { cpSync, rmSync } = await import("node:fs");
    cpSync(fixture("theme"), theme, { recursive: true });
    rmSync(path.join(theme, "templates", "index.tsx"));
    const out = path.join(dir, "out");
    const built = await run(["build", theme, "--out", out]);
    assert.equal(built.code, 1);
    assert.match(built.stderr, /templates\/index\.tsx:1:1 index_template_missing: /);
    assert.equal(readdirSync(dir).includes("out"), false);
    const checked = await run(["check", theme, "--json"]);
    assert.equal(checked.code, 1);
    assert.equal((JSON.parse(checked.stderr) as { code: string }[]).some((d) => d.code === "index_template_missing"), true);
  }));

test("check refuses --out and --zip, and content refuses --zip, with usage and exit 2", async () => {
  assert.equal((await run(["check", fixture("theme"), "--zip"])).code, 2);
  assert.equal((await run(["check", fixture("theme"), "--out", "x"])).code, 2);
  assert.equal((await run(["content", fixture("pricing.tsx"), "--zip"])).code, 2);
});
