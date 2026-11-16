// Differential test: run every scenario in app/tp/scenarios.mjs under Node against
// the installed files-sdk, then through the PHP that TypedPress generates, and compare
// the JSON output byte for byte.
//
//   TP_BIN=/abs/tp node verify.mjs [--expect-red] [--only <action>]
//
// --expect-red keeps the exit code 0 while the probe is blocked or diverges, so
// CI shows the state without blocking unrelated PRs. Remove the flag from CI in
// the PR that makes every scenario match.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { sourceFiles } from "./sources.mjs";
import { measure, table } from "./table.mjs";
import * as scenarios from "./app/tp/scenarios.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const { values: options } = parseArgs({
  options: { "expect-red": { type: "boolean", default: false }, only: { type: "string", multiple: true } },
});
const first = path.resolve(process.env.TP_BIN ?? path.join(root, "../../target/debug/typedpress"));
const work = path.join(root, ".work");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The scenarios and their inputs. Keep in step with app/typedpress.config.ts.
const CASES = [
  { action: "probe", input: { key: "hello.txt", body: "hello" }, node: (i) => probe(i) },
  { action: "roundtrip", input: { key: "notes/é ü.txt", body: "héllo \"wörld\" <b>" }, node: (i) => scenarios.roundtrip(i.key, i.body) },
  { action: "listing", input: {}, node: () => scenarios.listing() },
  { action: "mutate", input: {}, node: () => scenarios.mutate() },
  { action: "handles", input: {}, node: () => scenarios.handles() },
  { action: "errors", input: {}, node: () => scenarios.errors() },
].filter((entry) => !options.only || options.only.includes(entry.action));

async function probe(input) {
  const { Files } = await import("files-sdk");
  const { memory } = await import("files-sdk/memory");
  const files = new Files({ adapter: memory() });
  await files.upload(input.key, input.body, { contentType: "text/plain" });
  const got = await files.download(input.key);
  return { exists: await files.exists(input.key), text: await got.text() };
}

// 1. The installed bytes are the pinned ones.
const provenance = JSON.parse(await readFile(path.join(root, "provenance.json"), "utf8"));
const pinned = new Map(provenance.packages.flatMap((p) => p.files.map((f) => [`${p.name}/${f.path}`, f.sha256])));
const installed = await sourceFiles(path.join(root, "node_modules"));
for (const file of installed) {
  const id = `${file.package}/${file.path}`;
  if (pinned.get(id) !== sha256(file.bytes)) throw new Error(`${id} differs from provenance.json (run npm ci)`);
}
if (installed.length !== pinned.size) throw new Error(`reached ${installed.length} files, provenance pins ${pinned.size}`);

// 2. The diagnostic table for both variants.
const measured = await measure(first);
console.log(table(measured, `first ${measured.dist.compilerVersion}`));
console.log("");

// 3. Node against generated PHP, per action.
const outcomes = [];
if (measured.dist.ok) {
  const out = path.join(work, "out");
  await rm(out, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const build = spawnSync(first, ["build", path.join(root, "app"), "--out", out, "--quiet"], { encoding: "utf8" });
  if (build.status !== 0) outcomes.push({ action: "*", status: "build-error", detail: build.stderr.trim() });
  else
    for (const entry of CASES) {
      let expected;
      try {
        expected = JSON.stringify(await entry.node(entry.input));
      } catch (error) {
        throw new Error(`${entry.action}: Node threw ${error.stack}`);
      }
      const php = spawnSync("php", [path.join(root, "run-php.php"), out, entry.action, JSON.stringify(entry.input)], {
        encoding: "utf8",
      });
      const actual = php.stdout.replace(/\n$/, "");
      const status = php.status !== 0 ? "runtime-error" : actual === expected ? "match" : "mismatch";
      outcomes.push({ action: entry.action, status, expected, actual, stderr: php.stderr.trim() });
    }
  await writeFile(path.join(work, "verify.json"), JSON.stringify({ measured, outcomes }, null, 2) + "\n");
}

for (const o of outcomes) {
  console.log(`${o.action}\t${o.status}`);
  if (o.status !== "match") {
    if (o.expected !== undefined) console.log(`  node: ${o.expected}\n  php:  ${o.actual}`);
    if (o.stderr || o.detail) console.log(`  ${(o.stderr || o.detail).split("\n").slice(0, 8).join("\n  ")}`);
  }
}
const green = measured.dist.ok && outcomes.length > 0 && outcomes.every((o) => o.status === "match");
const state = !measured.dist.ok
  ? `blocked: dist probe has ${measured.dist.diagnostics.length} diagnostics`
  : green
    ? `PASS: ${outcomes.length} actions match Node byte for byte`
    : `ISSUES: ${outcomes.filter((o) => o.status !== "match").length} of ${outcomes.length} actions differ from Node`;
console.log(state);
if (green && options["expect-red"]) console.log("The probe is green: remove --expect-red from CI.");
if (!green) {
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=files-sdk probe (expected red)::${state}`);
  if (!options["expect-red"]) process.exitCode = 1;
}
