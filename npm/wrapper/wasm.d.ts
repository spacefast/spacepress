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

/** Compiles a project held in memory. */
export function compile(request: Request): Compiled;
/** The response exactly as the compiler serialized it. */
export function compileToJson(request: Request): string;
