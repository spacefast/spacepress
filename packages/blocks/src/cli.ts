import { writeFile } from "node:fs/promises";
import path from "node:path";

import { compileContent } from "./compiler/content.ts";
import { formatDiagnostic, hasErrors } from "./diagnostics.ts";

const USAGE = `usage:
  typedpress-blocks content <file.tsx> [--out <file.html>] [--json] [--verbose]

Compile one TSX file to Gutenberg block markup. Errors are reported with
file:line:column and exit 1; nothing is written on error.`;

interface Options {
  out?: string;
  json: boolean;
  verbose: boolean;
  positional: string[];
}

function parse(argv: readonly string[]): Options {
  const options: Options = { json: false, verbose: false, positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--out") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) throw new Error("--out needs a path");
      options.out = value;
      i += 1;
    } else if (arg === "--json") options.json = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    else options.positional.push(arg);
  }
  return options;
}

/** Returns the process exit code. */
export async function main(argv: readonly string[], io: { stdout: (s: string) => void; stderr: (s: string) => void } = { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) }): Promise<number> {
  let options: Options;
  try {
    options = parse(argv);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    return 2;
  }
  const [command, file] = options.positional;
  if (command !== "content" || file === undefined || options.positional.length !== 2) {
    io.stderr(`${USAGE}\n`);
    return 2;
  }
  const result = await compileContent(file);
  const shown = result.diagnostics.filter((d) => options.verbose || d.severity !== "info");
  const cwd = process.cwd();
  if (options.json) {
    const place = (loc: { file: string; line: number; column: number } | undefined) => (loc ? { file: path.relative(cwd, loc.file), line: loc.line, column: loc.column } : null);
    io.stderr(`${JSON.stringify(shown.map((d) => ({ code: d.code, severity: d.severity, message: d.message, hint: d.hint ?? null, ...(place(d.loc) ?? { file: null, line: null, column: null }), usedAt: place(d.loc?.usedAt) })), null, 2)}\n`);
  } else {
    for (const diagnostic of shown) io.stderr(`${formatDiagnostic(diagnostic, cwd)}\n`);
  }
  if (hasErrors(result.diagnostics)) return 1;
  if (options.out) await writeFile(options.out, result.markup.endsWith("\n") ? result.markup : `${result.markup}\n`);
  else io.stdout(result.markup.endsWith("\n") || result.markup === "" ? result.markup : `${result.markup}\n`);
  return 0;
}
