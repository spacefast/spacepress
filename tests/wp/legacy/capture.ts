// Regenerates content-model.php with the original Zero compiler. Needs a checkout of the original
// monorepo (packages/zero-compile at 0.8.1): `ZERO_ORIGINAL=<checkout> bun tests/wp/legacy/capture.ts`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.ZERO_ORIGINAL;
if (!root) throw new Error("set ZERO_ORIGINAL to the original monorepo checkout");
const here = dirname(fileURLToPath(import.meta.url));
const model = await import(join(root, "packages/zero-compile/src/content-model.ts"));
const php = await import(join(root, "packages/zero-compile/src/content-model-php.ts"));
const source = readFileSync(join(here, "capsule.ts"), "utf8");
const declarations = model.parseContentDeclarations(source, source);
const compiled = await model.compileZeroContentModel({ declarations, readDirectory: async () => [] });
writeFileSync(join(here, "content-model.php"), (await php.generateContentModelPhp(compiled.artifacts.model)).php);
