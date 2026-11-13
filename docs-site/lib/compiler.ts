// The First compiler core in the browser: `compiler.wasm` is `src/wasm.rs` built for
// wasm32-unknown-unknown. One call compiles a whole config from memory; the diagnostics envelope is
// the one `first check --json` prints.

export interface Request {
  /** The project's name: the app plugin is `first-app-<name>`. */
  name: string;
  /** Sources by project-relative path; `first.config.ts` is the entry. */
  files: Record<string, string>;
  /** The last build's `first/_generated/migrations/snapshot.json`, or null for a first build. */
  previous?: unknown;
  /** The file names beside that snapshot; they number the next migration like `first build` does. */
  migrationFiles?: string[];
  /** Refuse plugin grants beyond `first/_generated/plugins.lock.json` in `files`, like `first check --frozen` and CI. */
  frozen?: boolean;
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

/** `first check --json`'s envelope (docs/compiler-diagnostics.md). */
export interface Envelope {
  schema: "first-diagnostics";
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
  /** Declared WordPress plugins outside the tested list; they still install. */
  unsupportedPlugins: string[];
  hints: string[];
  /**
   * Every file of the `first-app-<name>` plugin `first build` writes, by path below the plugins
   * directory: the `.sql` files under `first/_generated/migrations/` in the request and this
   * compile's new migrations. Its `first/app/openapi.json` is the app's API as an OpenAPI 3.1
   * document, the file `first build` also writes to `first/_generated/openapi.json`.
   */
  appPlugin: Record<string, string>;
  /** First's plugins for this app, in activation order. */
  firstPlugins: string[];
  /** The WordPress.org plugins the app needs, dependencies first. */
  wordpressPlugins: { slug: string; version: string }[];
}

export interface Compiled {
  check: Envelope;
  /** Present when `check.ok`. */
  output: Output | null;
}

interface Exports {
  memory: WebAssembly.Memory;
  first_alloc(len: number): number;
  first_compile(ptr: number, len: number): number;
  first_free(ptr: number, len: number): void;
}

/**
 * Compiles while the module downloads when the server sends `application/wasm`; otherwise it reads
 * the bytes first. A host that serves the file with another type still gets a working compiler.
 */
async function instantiateResponse(response: Response, imports: WebAssembly.Imports) {
  if (!response.ok) throw new Error(`Could not load the compiler: HTTP ${response.status}`);
  if (response.headers.get("content-type")?.startsWith("application/wasm")) return WebAssembly.instantiateStreaming(response, imports);
  return WebAssembly.instantiate(await response.arrayBuffer(), imports);
}

export class Compiler {
  readonly #exports: Exports;

  private constructor(exports: Exports) {
    this.#exports = exports;
  }

  /** From the module's bytes (Node, tests) or a fetch of it (the browser). */
  static async load(source: BufferSource | Response | Promise<Response>): Promise<Compiler> {
    const unavailable = () => { throw new Error("Host filesystem requires a host adapter; pass files in memory in the browser"); };
    const imports = { host: { read_file: unavailable, stat: unavailable, canonicalize: unavailable, read_dir: unavailable } };
    const result =
      source instanceof ArrayBuffer || ArrayBuffer.isView(source)
        ? await WebAssembly.instantiate(source, imports)
        : await instantiateResponse(await source, imports);
    return new Compiler(result.instance.exports as unknown as Exports);
  }

  compile(request: Request): Compiled {
    const parsed = JSON.parse(this.compileToJson(request)) as Compiled | { error: string };
    if ("error" in parsed) throw new Error(parsed.error);
    return parsed;
  }

  /** The response as the compiler serialized it, for byte-for-byte comparison with `first check --json`. */
  compileToJson(request: Request): string {
    const { memory, first_alloc, first_compile, first_free } = this.#exports;
    const bytes = new TextEncoder().encode(JSON.stringify(request));
    // Pointers cross the boundary as i32; addresses past 2 GiB come back negative.
    const input = first_alloc(bytes.length) >>> 0;
    new Uint8Array(memory.buffer, input, bytes.length).set(bytes);
    // first_compile takes ownership of the request buffer.
    const output = first_compile(input, bytes.length) >>> 0;
    const length = new DataView(memory.buffer, output, 4).getUint32(0, true);
    const text = new TextDecoder().decode(new Uint8Array(memory.buffer, output + 4, length));
    first_free(output, 4 + length);
    return text;
  }
}
