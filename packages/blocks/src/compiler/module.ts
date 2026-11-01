import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire, SourceMap } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build, type Plugin } from "esbuild";

import { ContentError, type Diagnostic } from "../diagnostics.ts";
import { exclusive } from "./exclusive.ts";
import { toContentNodes } from "../jsx-runtime.ts";
import type { ContentNode, SourceLocation } from "../nodes.ts";

/**
 * Run an authored `.tsx` at build time and return what its default export
 * rendered.
 *
 * Bundle it to one ES module with esbuild (the dev JSX transform, so every
 * element carries its file, line and column), write it to a fresh temp
 * directory, import it, call the default export once. The JSX runtime is
 * resolved to this package's own copy, so nothing in the author's
 * `node_modules` can change what a file compiles to.
 *
 * Authored modules are trusted code run in this process, like any build
 * config. The neutral platform makes a static `node:*` import a bundle error,
 * which catches the common accident; it is not a sandbox.
 */

const requireFromHere = createRequire(import.meta.url);

const RUNTIME_SPECIFIER = /^@spacefast\/zero-blocks(?:\/(?:jsx-runtime|jsx-dev-runtime))?$/;

function runtimePlugin(): Plugin {
  return {
    name: "zero-blocks-runtime",
    setup(b) {
      b.onResolve({ filter: RUNTIME_SPECIFIER }, (args) => {
        const sub = args.path === "@spacefast/zero-blocks" ? "index" : args.path.slice("@spacefast/zero-blocks/".length);
        // During development the sources are .ts beside this file; a built package has .js.
        for (const ext of [".ts", ".js"]) {
          try {
            return { path: requireFromHere.resolve(`../${sub}${ext}`) };
          } catch {
            /* try the next */
          }
        }
        return null;
      });
    },
  };
}

export interface ModuleResult {
  /** What the default export rendered, normalized to content nodes; empty on error. */
  nodes: ContentNode[];
  diagnostics: Diagnostic[];
}

interface EsbuildMessage {
  text: string;
  location?: { file: string; line: number; column: number } | null;
}

function esbuildLocation(root: string, message: EsbuildMessage): SourceLocation | undefined {
  if (!message.location) return undefined;
  return { file: path.resolve(root, message.location.file), line: message.location.line, column: message.location.column + 1 };
}

/**
 * The author's frame of a thrown error: the first bundle frame, mapped back
 * through esbuild's source map to a file that is not this package's runtime.
 */
function thrownLocation(error: unknown, bundlePath: string, map: SourceMap, scratch: string): SourceLocation | undefined {
  if (!(error instanceof Error) || typeof error.stack !== "string") return undefined;
  // fileURLToPath, not URL.pathname: a space in the package or temp path is `%20` in the URL and a space on disk.
  const runtimeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const line of error.stack.split("\n")) {
    const match = /\(?((?:file:\/\/)?\/[^():]+\.[cm]?[jt]sx?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!match) continue;
    const file = match[1]!.startsWith("file://") ? fileURLToPath(match[1]!) : match[1]!;
    if (file !== bundlePath) continue;
    const origin = map.findOrigin(Number(match[2]), Number(match[3]));
    if (!("fileName" in origin) || typeof origin.fileName !== "string") continue;
    const source = path.resolve(scratch, origin.fileName);
    if (source.startsWith(`${runtimeDir}${path.sep}`)) continue;
    return { file: source, line: origin.lineNumber, column: origin.columnNumber };
  }
  return undefined;
}

/** Bundle, execute, and return whatever the module's default export rendered. */
export async function renderModule(file: string): Promise<ModuleResult> {
  const entry = path.resolve(file);
  const root = path.dirname(entry);
  const scratch = await mkdtemp(path.join(tmpdir(), "zero-blocks-"));
  const bundlePath = path.join(scratch, "module.mjs");
  let code: string;
  let map: SourceMap;
  try {
    const result = await build({
      entryPoints: [entry],
      absWorkingDir: root,
      bundle: true,
      format: "esm",
      platform: "neutral",
      mainFields: ["module", "main"],
      conditions: ["import", "default"],
      target: "es2023",
      jsx: "automatic",
      jsxDev: true,
      jsxImportSource: "@spacefast/zero-blocks",
      tsconfigRaw: {},
      // esbuild writes jsxDEV's fileName relative to absWorkingDir; the runtime resolves it
      // against this, so every location is absolute whatever the caller's cwd is.
      define: { "globalThis.__zeroBlocksSourceRoot": JSON.stringify(root) },
      outfile: bundlePath,
      sourcemap: "external",
      sourcesContent: false,
      write: false,
      logLevel: "silent",
      plugins: [runtimePlugin()],
    });
    const js = result.outputFiles.find((f) => f.path === bundlePath)!;
    const mapFile = result.outputFiles.find((f) => f.path === `${bundlePath}.map`)!;
    code = Buffer.from(js.contents).toString("utf8");
    map = new SourceMap(JSON.parse(Buffer.from(mapFile.contents).toString("utf8")) as ConstructorParameters<typeof SourceMap>[0]);
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    const messages = (error as { errors?: EsbuildMessage[] }).errors ?? [];
    const diagnostics: Diagnostic[] = messages.length > 0
      ? messages.map((m) => {
          const d: Diagnostic = { code: "module_failed", severity: "error", message: m.text };
          const loc = esbuildLocation(root, m);
          if (loc) d.loc = loc;
          return d;
        })
      : [{ code: "module_failed", severity: "error", message: error instanceof Error ? error.message : String(error), loc: { file: entry, line: 1, column: 1 } }];
    return { nodes: [], diagnostics };
  }

  // Executed inside the process-wide section (see exclusive.ts), so the module never runs while
  // another compile has the serializer's DOM globals installed.
  return exclusive(async () => {
  try {
    await writeFile(bundlePath, code);
    let namespace: { default?: unknown };
    try {
      namespace = (await import(pathToFileURL(bundlePath).href)) as { default?: unknown };
    } catch (error) {
      return { nodes: [], diagnostics: [failure(error, entry, bundlePath, map, scratch)] };
    }
    if (typeof namespace.default !== "function") {
      return {
        nodes: [],
        diagnostics: [{ code: "default_export_missing", severity: "error", message: `${path.basename(entry)} has no default export.`, hint: "Export a function component as the default export.", loc: { file: entry, line: 1, column: 1 } }],
      };
    }
    try {
      // Normalizing here keeps a non-content return value (`() => new Date()`) inside the
      // same diagnostic boundary as a throw from inside the JSX.
      return { nodes: toContentNodes((namespace.default as () => unknown)(), { file: entry, line: 1, column: 1 }), diagnostics: [] };
    } catch (error) {
      return { nodes: [], diagnostics: [failure(error, entry, bundlePath, map, scratch)] };
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  });
}

function failure(error: unknown, entry: string, bundlePath: string, map: SourceMap, scratch: string): Diagnostic {
  // The runtime is bundled into the module, so its ContentError is a copy; match by shape.
  const code = (error as { code?: unknown })?.code;
  const isContent = error instanceof ContentError || (error instanceof Error && error.name === "ContentError" && typeof code === "string");
  const content = isContent ? (error as ContentError) : undefined;
  let loc = content?.loc ?? thrownLocation(error, bundlePath, map, scratch) ?? { file: entry, line: 1, column: 1 };
  // An error with no position of its own kept its component call site aside; now that the stack
  // has given it the authored position, the two are joined as they are for any located error.
  const calledFrom = content?.calledFrom;
  if (calledFrom !== undefined && loc.usedAt === undefined && !(loc.file === calledFrom.file && loc.line === calledFrom.line && loc.column === calledFrom.column)) {
    loc = { ...loc, usedAt: calledFrom };
  }
  return {
    code: isContent ? (code as Diagnostic["code"]) : "module_failed",
    severity: "error",
    message: error instanceof Error ? error.message : String(error),
    loc,
  };
}
