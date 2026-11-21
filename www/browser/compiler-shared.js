// Shared lazy singleton loader for the in-browser Rust/OXC WASM compiler and playground catalog.
// Both <tp-play> and <tp-sandbox> reuse the same instantiated compiler so compiler.wasm is fetched once.
import { Compiler } from "../lib/compiler.ts";

const base = new URL(".", import.meta.url);
let compilerPromise;
let playDataPromise;

export function loadCompiler() {
  compilerPromise ??= Compiler.load(fetch(new URL("compiler.wasm", base)));
  return compilerPromise;
}

export function loadPlayData() {
  playDataPromise ??= fetch(new URL("play-data.json", base)).then((r) => {
    if (!r.ok) throw new Error(`Could not load playground data (HTTP ${r.status})`);
    return r.json();
  });
  return playDataPromise;
}

export function loadAll() {
  return Promise.all([loadCompiler(), loadPlayData()]).then(([compiler, data]) => ({ compiler, data }));
}
