// Installs packed tarballs into a scratch project the way a user would and runs them: the `zero`
// bin through the wrapper, `binaryPath()`, and the wasm `compile` against `zero check --json`.
//
//   node npm/smoke.mjs <dir of .tgz files>
//
// The directory holds the wrapper's tarball and this machine's platform tarball.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const npm = path.dirname(fileURLToPath(import.meta.url));
const { package: name } = JSON.parse(readFileSync(path.join(npm, "targets.json"), "utf8"));
const tarballs = path.resolve(process.argv[2] ?? "");
const scope = name.split("/")[0].slice(1);
const prefix = `${scope}-${name.split("/")[1]}-`;
const packed = readdirSync(tarballs).filter((file) => file.endsWith(".tgz"));
const platform = `${process.platform}-${process.arch}`;
const wrapper = packed.find((file) => file.startsWith(prefix) && /^\d/.test(file.slice(prefix.length)));
const binary = packed.find((file) => file.startsWith(`${prefix}${platform}-`));
assert.ok(wrapper, `no ${name} tarball in ${tarballs}`);
assert.ok(binary, `no ${name}-${platform} tarball in ${tarballs}`);

const project = mkdtempSync(path.join(tmpdir(), "zero-npm-smoke-"));
const shell = process.platform === "win32";
const run = (command, args) => execFileSync(command, args, { cwd: project, encoding: "utf8", shell });
try {
  writeFileSync(path.join(project, "package.json"), '{ "name": "smoke", "private": true, "type": "module" }\n');
  // The platform package is not on the registry yet, so it is installed from its tarball first and
  // the wrapper's optional dependency on it is already satisfied.
  run("npm", ["install", "--no-audit", "--no-fund", path.join(tarballs, binary), path.join(tarballs, wrapper)]);

  const config = `import { defineConfig, table, text } from "zero";

export const notes = table({ body: text().notNull() });

export default defineConfig({ name: "smoke", tables: { notes } });
`;
  writeFileSync(path.join(project, "zero.config.ts"), config);

  const cli = JSON.parse(run("npx", ["--no-install", "zero", "check", ".", "--json"]));
  assert.equal(cli.ok, true, JSON.stringify(cli));

  const script = `
import { binaryPath } from ${JSON.stringify(name)};
import { compile } from ${JSON.stringify(`${name}/wasm`)};
import { readFileSync } from "node:fs";
const compiled = compile({ name: "smoke", files: { "zero.config.ts": readFileSync("zero.config.ts", "utf8") } });
console.log(JSON.stringify({ binary: binaryPath(), ok: compiled.check.ok, migrations: compiled.output?.migrations.length }));
`;
  writeFileSync(path.join(project, "probe.mjs"), script);
  const probe = JSON.parse(run("node", ["probe.mjs"]));
  assert.equal(probe.ok, true);
  assert.equal(probe.migrations, 1);
  assert.ok(probe.binary.includes(`${name}-${platform}`), probe.binary);
  console.log(`${platform}: zero check ok; wasm compile ok; binary ${probe.binary}`);
} finally {
  rmSync(project, { recursive: true, force: true });
}
