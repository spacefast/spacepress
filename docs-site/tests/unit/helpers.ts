import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const repo = path.dirname(site);

const target = process.env.CARGO_TARGET_DIR ?? path.join(repo, "target");

/** `pnpm wasm` must have run. */
export function wasmPath(): string {
  const served = process.env.TP_WASM_PATH ?? path.join(site, "public/compiler.wasm");
  if (!existsSync(served)) throw new Error(`${served} is missing; run pnpm wasm`);
  return served;
}

/** The native compiler, for parity: a release build if there is one, else debug. */
export function tpBinary(): string {
  for (const profile of ["release", "debug"]) {
    const candidate = path.join(target, profile, "typedpress");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`no typedpress binary under ${target}; run cargo build`);
}
