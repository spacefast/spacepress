import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { probes, combined, popularCombined } from "./cases.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const work = path.join(root, ".work");
const zero = path.resolve(process.env.ZERO_BIN ?? path.resolve(root, "../../target/debug/zero"));
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};
const hash = (source) => createHash("sha256").update(source).digest("hex");
function adaptModule(probe, source) {
  if (probe.format === "esm") return source;
  if (probe.format === "cjs-named-function") {
    const exportLine = `module.exports = ${probe.binding};`;
    assert.equal(
      source.split(exportLine).length,
      2,
      "CJS adapter requires exactly one known export",
    );
    return source.replace(exportLine, `export default ${probe.binding};`);
  }
  const exportStart = "module.exports = function";
  assert.equal(
    source.split(exportStart).length,
    2,
    "CJS adapter requires exactly one known export",
  );
  return source.replace(exportStart, `export default function ${probe.binding}`);
}
function typedSource(probe, source) {
  if (probe.typedAdapter === "number-pair")
    return source.replace("(a, b)", "(a: number, b: number)");
  if (probe.typedAdapter === "string-callbacks")
    return source
      .replaceAll("= (x)", "= (x: string)")
      .replaceAll("= (x, delim =", "= (x: string, delim =");
  if (probe.typedAdapter === "unknown-number")
    return source.replace("function isNumber(num)", "function isNumber(num: unknown)");
  return source;
}
const importLine = (entry, specifier) =>
  `import ${entry.named ? "{" + entry.binding + "}" : entry.binding} from ${JSON.stringify(specifier)};`;
const config = `import {action, defineConfig} from "zero";
import {run} from "./run";
export default defineConfig({name: "npm-compat", actions: {probe: action({access: "anyone", input: {}, handler: () => run()})}});
`;
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
const report = { compiler: zero, binarySha256: hash(await readFile(zero)), packages: [], probes: [] };
for (const probe of probes) {
  const packageRoot = path.join(root, "node_modules", probe.name);
  const metadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(metadata.version, probe.version, "probe source version must remain pinned");
  const source = await readFile(path.join(packageRoot, probe.entry), "utf8");
  report.packages.push({
    name: probe.name,
    version: probe.version,
    entry: probe.entry,
    license: metadata.license,
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: hash(source),
    adaptation:
      probe.format === "esm"
        ? "copied source bytes unchanged"
        : "module.exports → export default only; algorithm unchanged",
  });
}
for (const probe of [...probes, combined, popularCombined]) {
  const libraries = probe.libraries
    ? probes.filter((entry) => probe.libraries.includes(entry.name))
    : [probe];
  const result = { name: probe.name, oracle: null, routes: [] };
  const oracleDirectory = path.join(work, probe.name);
  await mkdir(oracleDirectory, { recursive: true });
  const bareImports = libraries
    .map((entry) => importLine(entry, entry.specifier ?? entry.name))
    .join("\n");
  const functionSource = `export function run() { ${probe.body} }\n`;
  await writeFile(path.join(oracleDirectory, "oracle.mjs"), bareImports + "\n" + functionSource);
  const oracle = await import(pathToFileURL(path.join(oracleDirectory, "oracle.mjs")).href);
  result.oracle = JSON.parse(JSON.stringify(await oracle.run()));
  for (const mode of [
    "bare",
    "source",
    ...(libraries.some((entry) => entry.typedAdapter) ? ["typed-source", "typed-installed"] : []),
  ]) {
    const directory = path.join(oracleDirectory, mode);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "zero.config.ts"), config);
    const imports = [];
    for (const entry of libraries) {
      const source = await readFile(
        path.join(root, "node_modules", entry.name, entry.entry),
        "utf8",
      );
      const filename = `${entry.name.replaceAll("/", "-").replaceAll("@", "")}.ts`;
      const adapted = adaptModule(entry, source);
      await writeFile(
        path.join(directory, filename),
        mode.startsWith("typed-") ? typedSource(entry, adapted) : adapted,
      );
      let specifier = mode === "bare" ? (entry.specifier ?? entry.name) : "./" + filename;
      if (mode === "typed-installed") {
        const packageName =
          "@zero-npm-compat/" + entry.name.replaceAll("/", "-").replaceAll("@", "");
        const packageDirectory = path.join(directory, "node_modules", packageName);
        await mkdir(packageDirectory, { recursive: true });
        await writeFile(
          path.join(packageDirectory, "package.json"),
          JSON.stringify({
            name: packageName,
            private: true,
            type: "module",
            exports: { ".": { import: "./index.ts" } },
          }),
        );
        await writeFile(path.join(packageDirectory, "index.ts"), typedSource(entry, adapted));
        specifier = packageName;
      }
      imports.push(importLine(entry, specifier));
    }
    await writeFile(path.join(directory, "run.ts"), imports.join("\n") + "\n" + functionSource);
    const checked = run(zero, ["check", directory, "--json"]);
    const route = {
      mode,
      inputDirectory: directory,
      check: checked,
      diagnostic: null,
      build: null,
      php: null,
      status: "blocked",
    };
    try {
      route.diagnostic = JSON.parse(checked.stdout);
    } catch {
      /* Retain malformed output verbatim. */
    }
    if (checked.status === 0) {
      const output = path.join(directory, `out-${mode}`);
      route.build = run(zero, ["build", directory, "--out", output]);
      if (route.build.status === 0) {
        route.php = run("php", [path.join(root, "run-php.php"), output]);
        if (route.php.status === 0) {
          try {
            assert.deepEqual(JSON.parse(route.php.stdout), result.oracle);
            route.status = "pass";
          } catch (error) {
            route.status = "mismatch";
            route.mismatch = error.message;
          }
        } else route.status = "runtime-error";
      } else route.status = "build-error";
    }
    const message = route.diagnostic?.diagnostics?.[0]?.message ?? "";
    route.failureKind =
      route.status === "pass"
        ? null
        : route.status !== "blocked"
          ? route.status
          : message.includes("CommonJS")
            ? "module-format"
            : route.diagnostic?.diagnostics?.[0]?.code === "Z1003"
              ? "module-resolution"
              : message.includes("needs a type") || message.startsWith("unknown type")
                ? "typing"
                : message.includes("Zero code doesn't support")
                  ? "language"
                  : "typing-or-runtime-capability";
    result.routes.push(route);
    const diagnostic =
      route.diagnostic?.diagnostics?.[0]?.message ??
      route.php?.stderr ??
      route.build?.stderr ??
      checked.stderr;
    console.log(
      `${probe.name}\t${mode}\t${route.status}\t${route.status === "pass" ? "matches Node" : diagnostic.trim()}`,
    );
  }
  report.probes.push(result);
}
await writeFile(path.join(work, "report.json"), JSON.stringify(report, null, 2) + "\n");
const passed = report.probes.every((probe) =>
  probe.routes.some((route) => route.status === "pass"),
);
console.log(
  `${passed ? "PASS" : "ISSUES"}: raw diagnostics, Node outcomes, PHP output, and source hashes: ${path.join(work, "report.json")}`,
);
if (!passed && !process.argv.includes("--report-only")) process.exitCode = 1;
