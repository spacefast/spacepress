import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("../", import.meta.url));
const repo = resolve(site, "..");
const target = resolve(repo, process.env.CARGO_TARGET_DIR ?? "target");
const binary = resolve(target, "debug/typedpress");
const env = { ...process.env, CARGO_TARGET_DIR: target, TP_BIN: binary };

function run(command, args, cwd = site) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("bun", ["install", "--frozen-lockfile"]);
run("cargo", ["build", "--locked", "--bin", "typedpress"], repo);
run(process.execPath, ["scripts/build-wasm.mjs"]);
run(process.execPath, ["scripts/build-showcase.ts"]);
run("bun", ["scripts/build.mjs"]);
run(binary, ["check"]);
run(binary, ["build"]);
