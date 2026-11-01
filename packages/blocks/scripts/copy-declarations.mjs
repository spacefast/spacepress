// tsc emits declarations for .ts inputs but does not copy hand-written or generated .d.ts
// files, so the published dist/ would reference a theme-json.generated.d.ts that is not there.
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const relative of ["theme/theme-json.generated.d.ts"]) {
  const target = path.join(root, "dist", relative);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(root, "src", relative), target);
}
