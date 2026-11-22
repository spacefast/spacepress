import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { probes, combined, popularCombined, applicationCombined } from "./cases.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const { values: options } = parseArgs({ options: {
  "report-only": { type: "boolean", default: false },
  isolated: { type: "boolean", default: false },
  only: { type: "string", multiple: true },
} });
const work = options.isolated ? await mkdtemp(path.join(tmpdir(), "typedpress-framework-compiler-npm-")) : path.join(root, ".work");
const modules = path.resolve(process.env.NPM_COMPAT_NODE_MODULES ?? path.join(root, "node_modules"));
const compiler = path.resolve(process.env.TP_BIN ?? path.resolve(root, "../../target/debug/typedpress"));
const first = path.join(work, process.platform === "win32" ? "typedpress.exe" : "first");
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
// Each case builds this app and runs only its action in PHP: no admin plugin to write and zip.
const config = `import {defineConfig, query} from "typedpress";
import {run} from "./tp/run";
export const probe = query({ access: "anyone" }, () => run());
export default defineConfig({name: "npm-compat", admin: false});
`;
if (!options.isolated) await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
await symlink(modules, path.join(work, "node_modules"), "dir");
const binary = await readFile(compiler);
await writeFile(first, binary, { mode: 0o700 });
const provenance = JSON.parse(await readFile(path.join(root, "provenance.json"), "utf8"));
const report = { compiler, snapshot: first, binarySha256: hash(binary), packages: [], probes: [] };
for (const probe of probes) {
  const packageRoot = path.join(modules, probe.name);
  const metadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(metadata.version, probe.version, "probe source version must remain pinned");
  const source = await readFile(path.join(packageRoot, probe.entry), "utf8");
  const pinned = provenance.packages.find(entry => entry.name === probe.name);
  assert.equal(pinned?.version, probe.version, "provenance version must remain pinned");
  assert.equal(hash(source), pinned.selectedSourceSha256, "published source hash differs from provenance");
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
const selected = [...probes, combined, popularCombined, applicationCombined].filter(probe => !options.only || options.only.includes(probe.name));
if (options.only?.some(name => !selected.some(probe => probe.name === name))) throw new Error("Unknown probe name");
for (const probe of selected) {
  const libraries = probe.libraries
    ? probes.filter((entry) => probe.libraries.includes(entry.name))
    : [probe];
  const result = { name: probe.name, fixtureSha256: probe.fixture ? hash(probe.fixture) : null, bodySha256: hash(probe.body), oracle: null, routes: [] };
  const oracleDirectory = path.join(work, probe.name);
  await mkdir(oracleDirectory, { recursive: true });
  const bareImports = libraries
    .map((entry) => importLine(entry, entry.specifier ?? entry.name))
    .join("\n");
  const fixtureImport = probe.fixture ? `import {fixture} from "./fixture.mjs";\n` : "";
  if (probe.fixture) await writeFile(path.join(oracleDirectory, "fixture.mjs"), probe.fixture);
  const functionSource = fixtureImport + `export function run() { ${probe.body} }\n`;
  await writeFile(path.join(oracleDirectory, "oracle.mjs"), bareImports + "\n" + functionSource);
  const oracle = await import(pathToFileURL(path.join(oracleDirectory, "oracle.mjs")).href);
  result.oracle = JSON.parse(JSON.stringify(await oracle.run()));
  for (const mode of [
    "bare",
    "source",
    ...(libraries.some((entry) => entry.typedAdapter) ? ["typed-source", "typed-installed"] : []),
  ]) {
    const directory = path.join(oracleDirectory, mode);
    // App code the config imports lives under tp/ (#229); copied library sources sit beside it.
    const app = path.join(directory, "tp");
    await mkdir(app, { recursive: true });
    if (probe.fixture) await writeFile(path.join(app, "fixture.mjs"), probe.fixture);
    await writeFile(path.join(directory, "typedpress.config.ts"), config);
    const imports = [];
    for (const entry of libraries) {
      const source = await readFile(
        path.join(modules, entry.name, entry.entry),
        "utf8",
      );
      const extension = mode.startsWith("typed-") ? ".ts" : path.extname(entry.entry);
      const filename = `${entry.name.replaceAll("/", "-").replaceAll("@", "")}${extension}`;
      const adapted = adaptModule(entry, source);
      await writeFile(
        path.join(app, filename),
        mode.startsWith("typed-") ? typedSource(entry, adapted) : adapted,
      );
      let specifier = mode === "bare" ? (entry.specifier ?? entry.name) : "./" + filename;
      if (mode === "typed-installed") {
        const packageName =
          "@typedpress-npm-compat/" + entry.name.replaceAll("/", "-").replaceAll("@", "");
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
    await writeFile(path.join(app, "run.ts"), imports.join("\n") + "\n" + functionSource);
    const checked = run(first, ["check", directory, "--json"]);
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
      route.build = run(first, ["build", directory, "--out", output]);
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
            : route.diagnostic?.diagnostics?.[0]?.code === "F1003"
              ? "module-resolution"
              : message.includes("needs a type") || message.startsWith("unknown type")
                ? "typing"
                : message.includes("TypedPress code doesn't support")
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
  probe.routes.every((route) => route.status === "pass"),
);
console.log(
  `${passed ? "PASS" : "ISSUES"}: raw diagnostics, Node outcomes, PHP output, and source hashes: ${path.join(work, "report.json")}`,
);
if (!passed && !options["report-only"]) process.exitCode = 1;
