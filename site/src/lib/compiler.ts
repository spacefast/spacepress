// The Zero compiler core in the browser: `zero.wasm` is `src/wasm.rs` built for
// wasm32-unknown-unknown. One call compiles a whole config from memory; the diagnostics envelope is
// the one `zero check --json` prints.

export interface Request {
  /** The project's name: the app plugin is `zero-app-<name>`. */
  name: string;
  /** Sources by project-relative path; `zero.config.ts` is the entry. */
  files: Record<string, string>;
  /** The last build's `zero/migrations/snapshot.json`, or null for a first build. */
  previous?: unknown;
  /** The file names beside that snapshot; they number the next migration like `zero build` does. */
  migrationFiles?: string[];
}

export interface Location {
  file: string;
  start: number;
  end: number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface Diagnostic {
  code: string;
  category: string;
  severity: string;
  message: string;
  help: string | null;
  location: Location | null;
  group: string;
}

/** `zero check --json`'s envelope (docs/compiler-diagnostics.md). */
export interface Envelope {
  schema: "zero-diagnostics";
  version: number;
  compilerVersion: string;
  ok: boolean;
  offsetEncoding: string;
  positionEncoding: string;
  diagnostics: Diagnostic[];
  groups: { id: string; code: string; message: string; sites: (Location | null)[] }[];
}

export interface Output {
  schemaPhp: string;
  functionsPhp: string;
  /** New migration files as `[name, sql]`. */
  migrations: [string, string][];
  snapshot: unknown;
  /** `types.ts` and `schema.ts`; the runtime half of the client is not generated here. */
  client: Record<string, string>;
  genTs: string;
  warnings: string[];
  hints: string[];
}

export interface Compiled {
  check: Envelope;
  /** Present when `check.ok`. */
  output: Output | null;
}

interface Exports {
  memory: WebAssembly.Memory;
  zero_alloc(len: number): number;
  zero_compile(ptr: number, len: number): number;
  zero_free(ptr: number, len: number): void;
}

export class Compiler {
  readonly #exports: Exports;

  private constructor(exports: Exports) {
    this.#exports = exports;
  }

  /** From the module's bytes (Node, tests) or a fetch of it (the browser). */
  static async load(source: BufferSource | Response | Promise<Response>): Promise<Compiler> {
    const result =
      source instanceof ArrayBuffer || ArrayBuffer.isView(source)
        ? await WebAssembly.instantiate(source, {})
        : await WebAssembly.instantiateStreaming(source, {});
    return new Compiler(result.instance.exports as unknown as Exports);
  }

  compile(request: Request): Compiled {
    const parsed = JSON.parse(this.compileToJson(request)) as Compiled | { error: string };
    if ("error" in parsed) throw new Error(parsed.error);
    return parsed;
  }

  /** The response as the compiler serialized it, for byte-for-byte comparison with `zero check --json`. */
  compileToJson(request: Request): string {
    const { memory, zero_alloc, zero_compile, zero_free } = this.#exports;
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
}
