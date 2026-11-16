// Print the `typedpress check --json` diagnostics of both probe variants as one
// stable Markdown table: count per (code, message), largest first. Locations
// are left out so two runs diff cleanly.
//
//   TP_BIN=/abs/tp node table.mjs [--probes] [--json out.json] [--label "main 15bea535"]
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

export function check(first, app) {
  const result = spawnSync(first, ["check", app, "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`typedpress check printed no JSON (exit ${result.status}):\n${result.stderr}`);
  }
  return { ok: report.ok === true, compilerVersion: report.compilerVersion, diagnostics: report.diagnostics };
}

export async function measure(first) {
  const variants = { dist: path.join(root, "app"), raw: await buildRawSrc() };
  const out = {};
  for (const [name, app] of Object.entries(variants)) out[name] = check(first, app);
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
  const first = path.resolve(process.env.TP_BIN ?? path.join(root, "../../target/debug/typedpress"));
  const results = await measure(first);
  if (values.probes) results.probes = await runProbes(first, path.join(root, ".work/probes"));
  if (values.json) await writeFile(values.json, JSON.stringify(results, null, 2) + "\n");
  console.log(table(results, values.label ?? `first ${results.dist.compilerVersion}`));
  if (results.probes) console.log(`\n**Host APIs** (one probe app each, \`typedpress check\`)\n\n${probeTable(results.probes)}`);
}
