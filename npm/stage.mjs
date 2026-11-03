// Assembles the npm packages from built artifacts: one package per platform holding its `zero`
// binary, and the wrapper whose optionalDependencies list them (npm/wrapper, plus zero.wasm and the
// "zero" type declarations). The names come from npm/targets.json; the version from Cargo.toml.
//
//   node npm/stage.mjs --artifacts <dir> --out <dir> [--only <os-cpu>]
//
// <dir> holds `zero-<os>-<cpu>` (`.exe` on Windows) for every target and `zero.wasm`. `--only`
// stages one platform package and the wrapper, for a local check on one machine.
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const npm = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(npm);
const { values } = parseArgs({
  options: { artifacts: { type: "string" }, out: { type: "string" }, only: { type: "string" } },
});
if (!values.artifacts || !values.out) {
  console.error("usage: node npm/stage.mjs --artifacts <dir> --out <dir> [--only <os-cpu>]");
  process.exit(2);
}
const artifacts = path.resolve(values.artifacts);
const out = path.resolve(values.out);

const { package: name, targets } = JSON.parse(readFileSync(path.join(npm, "targets.json"), "utf8"));
const version = readFileSync(path.join(repo, "Cargo.toml"), "utf8").match(/^version = "(.+)"$/m)[1];
const shared = {
  version,
  license: "MIT AND GPL-2.0-or-later",
  repository: { type: "git", url: "git+https://github.com/spacefast/zero.git" },
};
const platforms = Object.keys(targets).filter((platform) => !values.only || platform === values.only);
if (platforms.length === 0) {
  console.error(`unknown platform ${values.only}; expected one of ${Object.keys(targets).join(", ")}`);
  process.exit(2);
}

function need(file) {
  if (!existsSync(file)) {
    console.error(`missing artifact ${path.relative(process.cwd(), file)}`);
    process.exit(1);
  }
  return file;
}

function write(dir, files) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [file, contents] of Object.entries(files)) writeFileSync(path.join(dir, file), contents);
  for (const legal of ["LICENSE", "LICENSE-MIT", "LICENSE-GPL"]) copyFileSync(path.join(repo, legal), path.join(dir, legal));
}

for (const platform of platforms) {
  const [os, cpu] = platform.split("-");
  const exe = os === "win32" ? "zero.exe" : "zero";
  const dir = path.join(out, platform);
  write(dir, {
    "package.json": `${JSON.stringify(
      {
        name: `${name}-${platform}`,
        ...shared,
        description: `The Zero compiler binary for ${platform}. Install ${name}, which picks this package.`,
        os: [os],
        cpu: [cpu],
        files: ["bin"],
        preferUnplugged: true,
      },
      null,
      2,
    )}\n`,
    "README.md": `# ${name}-${platform}\n\nThe \`zero\` binary for ${platform}. Install [\`${name}\`](https://www.npmjs.com/package/${name}) instead; it depends on this package on ${platform} only.\n`,
  });
  mkdirSync(path.join(dir, "bin"));
  copyFileSync(need(path.join(artifacts, `zero-${platform}${os === "win32" ? ".exe" : ""}`)), path.join(dir, "bin", exe));
  chmodSync(path.join(dir, "bin", exe), 0o755);
}

const wrapper = path.join(out, "wrapper");
write(wrapper, {
  "package.json": `${JSON.stringify(
    {
      name,
      ...shared,
      description: "Compiles zero.config.ts into a PHP backend: migrations, REST, auth, a typed client and WordPress plugins",
      type: "module",
      bin: { zero: "bin/zero.js" },
      main: "index.js",
      types: "index.d.ts",
      exports: {
        ".": { types: "./index.d.ts", default: "./index.js" },
        "./wasm": { types: "./wasm.d.ts", default: "./wasm.js" },
        "./zero.wasm": "./zero.wasm",
        "./types": { types: "./types/index.d.ts" },
        "./package.json": "./package.json",
      },
      files: ["bin", "index.js", "index.d.ts", "wasm.js", "wasm.d.ts", "zero.wasm", "types"],
      engines: { node: ">=22" },
      optionalDependencies: Object.fromEntries(Object.keys(targets).map((platform) => [`${name}-${platform}`, version])),
    },
    null,
    2,
  )}\n`,
  "README.md": readFileSync(path.join(npm, "README.md"), "utf8"),
});
for (const file of ["index.js", "index.d.ts", "wasm.js", "wasm.d.ts"]) {
  copyFileSync(path.join(npm, "wrapper", file), path.join(wrapper, file));
}
cpSync(path.join(npm, "wrapper", "bin"), path.join(wrapper, "bin"), { recursive: true });
chmodSync(path.join(wrapper, "bin", "zero.js"), 0o755);
copyFileSync(need(path.join(artifacts, "zero.wasm")), path.join(wrapper, "zero.wasm"));
mkdirSync(path.join(wrapper, "types"));
copyFileSync(path.join(repo, "types", "zero", "index.d.ts"), path.join(wrapper, "types", "index.d.ts"));

console.log(`${name}@${version}: staged ${[...platforms, "wrapper"].join(", ")} in ${out}`);
