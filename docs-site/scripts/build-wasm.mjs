// Builds the compiler core for the browser (src/wasm.rs, wasm32-unknown-unknown) and puts it in
// public/, where the playground and the tests load it. `cargo build` is incremental.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
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

// The file is named after the crate, so it is found by extension rather than by name.
const out = path.join(target, "wasm32-unknown-unknown", "wasm");
const [built] = readdirSync(out).filter((name) => name.endsWith(".wasm"));
if (!built) throw new Error(`no .wasm under ${out}`);
const served = path.join(site, "public", "compiler.wasm");
mkdirSync(path.dirname(served), { recursive: true });
copyFileSync(path.join(out, built), served);
console.log(`${path.relative(repo, served)}: ${(statSync(served).size / 1024 / 1024).toFixed(1)} MiB`);
