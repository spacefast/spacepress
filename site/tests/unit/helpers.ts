import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const repo = path.dirname(site);

const target = process.env.CARGO_TARGET_DIR ?? path.join(repo, "target");

/** `pnpm build:wasm` must have run. */
export function wasmPath(): string {
  const served = process.env.ZERO_WASM_PATH ?? path.join(site, "public/zero.wasm");
  if (!existsSync(served)) throw new Error(`${served} is missing; run pnpm build:wasm`);
  return served;
}

/** The native compiler, for parity: a release build if there is one, else debug. */
export function zeroBinary(): string {
  for (const profile of ["release", "debug"]) {
    const candidate = path.join(target, profile, "zero");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`no zero binary under ${target}; run cargo build`);
}
