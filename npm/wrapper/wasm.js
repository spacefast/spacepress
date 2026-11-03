// The compiler core as WebAssembly (src/wasm.rs): `zero check` in-process, with no binary and no
// file system. The request and response are the ones site/src/lib/compiler.ts documents.
import { readFileSync } from "node:fs";

let exports;

function instance() {
  exports ??= new WebAssembly.Instance(
    new WebAssembly.Module(readFileSync(new URL("./zero.wasm", import.meta.url))),
    {},
  ).exports;
  return exports;
}

/** The response exactly as the compiler serialized it. */
export function compileToJson(request) {
  const { memory, zero_alloc, zero_compile, zero_free } = instance();
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  // Pointers cross the boundary as i32; addresses past 2 GiB come back negative.
  const input = zero_alloc(bytes.length) >>> 0;
  new Uint8Array(memory.buffer, input, bytes.length).set(bytes);
  // zero_compile takes ownership of the request buffer.
  const output = zero_compile(input, bytes.length) >>> 0;
  const length = new DataView(memory.buffer, output, 4).getUint32(0, true);
  const text = new TextDecoder().decode(new Uint8Array(memory.buffer, output + 4, length));
  zero_free(output, 4 + length);
  return text;
}

/** Compiles a project held in memory. `check` is `zero check --json`'s envelope. */
export function compile(request) {
  const parsed = JSON.parse(compileToJson(request));
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}
