import { fileURLToPath } from "node:url";
import { wp } from "../../../tests/wp/env.ts";
export * from "../../../tests/wp/env.ts";

export const harnessPath = fileURLToPath(new URL("../../../tests/wp/harness.sh", import.meta.url));

/** Exercise importer classes directly inside the destination WordPress. */
export function importEval(code: string): string {
  return wp("eval", `require_once '/tmp/typedpress-import/bootstrap.php'; ${code}`);
}

export function importArgs(operation: string, positionals: string[], flags: string[]): string[] {
  const options = Object.fromEntries(flags.map((flag) => {
    const [key, value] = flag.slice(2).split("=");
    return [key, value ?? true];
  }));
  return ["eval-file", "/tmp/typedpress-import/entry.php", JSON.stringify([operation, positionals, options])];
}
