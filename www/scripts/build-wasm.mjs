// Builds the compiler core for the browser (src/wasm.rs, wasm32-unknown-unknown) and puts it in
// .build/compiler.wasm, where scripts/build.mjs copies it into public/. `cargo build` is incremental.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const site = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(site);
const target = path.resolve(repo, process.env.CARGO_TARGET_DIR ?? "target");

const build = spawnSync(
	"cargo",
	["build", "--locked", "--lib", "--no-default-features", "--profile", "wasm", "--target", "wasm32-unknown-unknown"],
	{ cwd: repo, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: target } },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const out = path.join(target, "wasm32-unknown-unknown", "wasm");
const built = "typedpress.wasm";
if (!existsSync(path.join(out, built))) throw new Error(`${built} is missing under ${out}`);
const served = path.join(site, ".build", "compiler.wasm");
mkdirSync(path.dirname(served), { recursive: true });
copyFileSync(path.join(out, built), served);
console.log(`${path.relative(repo, served)}: ${(statSync(served).size / 1024 / 1024).toFixed(1)} MiB`);
