import { writeFile } from "node:fs/promises";
import path from "node:path";

import { compileContent } from "./compiler/content.ts";
import { buildTheme, writeTheme } from "./compiler/theme.ts";
import { formatDiagnostic, hasErrors, type Diagnostic } from "./diagnostics.ts";

const USAGE = `usage:
  zero-blocks content <file.tsx> [--out <file.html>] [--json] [--verbose]
  zero-blocks build <theme-dir> [--out <dir>] [--zip] [--json] [--verbose]
  zero-blocks check <theme-dir> [--json] [--verbose]

content  compile one TSX file to Gutenberg block markup.
build    compile a theme directory (theme.config.ts, templates/, parts/,
         patterns/, styles/, assets/) to <out>/<slug>/, replacing it whole;
         --zip also writes <out>/<slug>.zip. --out defaults to ./dist.
check    the same without writing anything.

Errors are reported with file:line:column and exit 1; nothing is written on
error. --json prints the diagnostics as JSON for tools.`;

interface Options {
  out?: string;
  zip: boolean;
  json: boolean;
  verbose: boolean;
  positional: string[];
}

function parse(argv: readonly string[]): Options {
  const options: Options = { zip: false, json: false, verbose: false, positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--out") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) throw new Error("--out needs a path");
      options.out = value;
      i += 1;
    } else if (arg === "--json") options.json = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (arg === "--zip") options.zip = true;
    else if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    else options.positional.push(arg);
  }
  return options;
}

interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function report(diagnostics: readonly Diagnostic[], options: Options, io: Io): void {
  const shown = diagnostics.filter((d) => options.verbose || d.severity !== "info");
  const cwd = process.cwd();
  if (options.json) {
    const place = (loc: { file: string; line: number; column: number } | undefined) => (loc ? { file: path.relative(cwd, loc.file), line: loc.line, column: loc.column } : null);
    io.stderr(`${JSON.stringify(shown.map((d) => ({ code: d.code, severity: d.severity, message: d.message, hint: d.hint ?? null, ...(place(d.loc) ?? { file: null, line: null, column: null }), usedAt: place(d.loc?.usedAt) })), null, 2)}\n`);
  } else {
    for (const diagnostic of shown) io.stderr(`${formatDiagnostic(diagnostic, cwd)}\n`);
  }
}

/** Returns the process exit code. */
export async function main(argv: readonly string[], io: Io = { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) }): Promise<number> {
  let options: Options;
  try {
    options = parse(argv);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    return 2;
  }
  const [command, target] = options.positional;
  if (target === undefined || options.positional.length !== 2) {
    io.stderr(`${USAGE}\n`);
    return 2;
  }
  switch (command) {
    case "content": {
      if (options.zip) {
        io.stderr(`--zip applies to build only\n${USAGE}\n`);
        return 2;
      }
      const result = await compileContent(target);
      report(result.diagnostics, options, io);
      if (hasErrors(result.diagnostics)) return 1;
      if (options.out) await writeFile(options.out, result.markup.endsWith("\n") ? result.markup : `${result.markup}\n`);
      else io.stdout(result.markup.endsWith("\n") || result.markup === "" ? result.markup : `${result.markup}\n`);
      return 0;
    }
    case "check":
    case "build": {
      if (command === "check" && (options.out !== undefined || options.zip)) {
        io.stderr(`check writes nothing; --out and --zip apply to build\n${USAGE}\n`);
        return 2;
      }
      const build = await buildTheme(target);
      report(build.diagnostics, options, io);
      if (hasErrors(build.diagnostics)) return 1;
      if (command === "build") {
        const written = await writeTheme(build, { out: options.out ?? "dist", zip: options.zip });
        io.stdout(`${path.relative(process.cwd(), written.dir)}/ (${build.files.length} files)${written.zip ? `\n${path.relative(process.cwd(), written.zip)}` : ""}\n`);
      }
      return 0;
    }
    default:
      io.stderr(`${USAGE}\n`);
      return 2;
  }
}
