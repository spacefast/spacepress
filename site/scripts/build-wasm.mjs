// Builds the compiler core for the browser and places it where Astro serves static files.
// `cargo build` is incremental, so a rebuild with unchanged sources is a copy.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const site = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(site);
const target = process.env.CARGO_TARGET_DIR ?? path.join(repo, "target");

const build = spawnSync(
  "cargo",
  ["build", "--locked", "--lib", "--no-default-features", "--profile", "wasm", "--target", "wasm32-unknown-unknown"],
  { cwd: repo, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: target } },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const built = path.join(target, "wasm32-unknown-unknown", "wasm", "first.wasm");
const served = path.join(site, "public", "first.wasm");
mkdirSync(path.dirname(served), { recursive: true });
copyFileSync(built, served);
console.log(`${path.relative(repo, served)}: ${(statSync(served).size / 1024 / 1024).toFixed(1)} MiB`);
