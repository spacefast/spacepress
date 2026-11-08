// Print the `zero check --json` diagnostics of both probe variants as one
// stable Markdown table: count per (code, message), largest first. Locations
// are left out so two runs diff cleanly.
//
//   ZERO_BIN=/abs/zero node table.mjs [--probes] [--json out.json] [--label "main 15bea535"]
//
// --probes adds a second section: one small app per host API (probes.mjs), in
// typed TS and in imported JS, because the syntax pass hides that layer.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildRawSrc } from "./raw-src.mjs";
import { probeTable, runProbes } from "./probes.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export function check(zero, app) {
  const result = spawnSync(zero, ["check", app, "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`zero check printed no JSON (exit ${result.status}):\n${result.stderr}`);
  }
  return { ok: report.ok === true, compilerVersion: report.compilerVersion, diagnostics: report.diagnostics };
}

export async function measure(zero) {
  const variants = { dist: path.join(root, "app"), raw: await buildRawSrc() };
  const out = {};
  for (const [name, app] of Object.entries(variants)) out[name] = check(zero, app);
  return out;
}

const cell = (text) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

export function table(results, label) {
  const rows = new Map();
  for (const variant of ["dist", "raw"])
    for (const diagnostic of results[variant].diagnostics) {
      const key = `${diagnostic.code}\u0000${diagnostic.message}`;
      const row = rows.get(key) ?? { code: diagnostic.code, message: diagnostic.message, dist: 0, raw: 0 };
      row[variant] += 1;
      rows.set(key, row);
    }
  const sorted = [...rows.values()].sort(
    (a, b) =>
      b.dist + b.raw - (a.dist + a.raw) ||
      b.dist - a.dist ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
  );
  const lines = [];
  if (label) lines.push(`**${label}**`, "");
  lines.push("| dist | raw | code | message |", "| ---: | ---: | --- | --- |");
  for (const row of sorted) lines.push(`| ${row.dist} | ${row.raw} | ${row.code} | ${cell(row.message)} |`);
  const status = (r) => (r.ok ? "compiles" : `${r.diagnostics.length} diagnostics`);
  lines.push(
    `| **${results.dist.diagnostics.length}** | **${results.raw.diagnostics.length}** | | total (dist ${status(results.dist)}, raw ${status(results.raw)}) |`,
  );
  return lines.join("\n");
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { json: { type: "string" }, label: { type: "string" }, probes: { type: "boolean", default: false } },
  });
  const zero = path.resolve(process.env.ZERO_BIN ?? path.join(root, "../../target/debug/zero"));
  const results = await measure(zero);
  if (values.probes) results.probes = await runProbes(zero, path.join(root, ".work/probes"));
  if (values.json) await writeFile(values.json, JSON.stringify(results, null, 2) + "\n");
  console.log(table(results, values.label ?? `zero ${results.dist.compilerVersion}`));
  if (results.probes) console.log(`\n**Host APIs** (one probe app each, \`zero check\`)\n\n${probeTable(results.probes)}`);
}
