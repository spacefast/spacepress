// The installed files the dist probe can reach: files-sdk's root and memory
// entries with every static import they pull in, followed across packages,
// plus relative CommonJS `require("./x")` targets. Dynamic `import()` targets
// are recorded but not followed (provider plugins the core loads on demand).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ENTRIES = [
  ["files-sdk", "dist/index.js"],
  ["files-sdk", "dist/memory/index.js"],
];
const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]/gm;
const REQUIRE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

function packageOf(modules, file) {
  const parts = path.relative(modules, file).split(path.sep);
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

async function resolveBare(modules, spec) {
  const parts = spec.split("/");
  const count = spec.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, count).join("/");
  const sub = parts.length > count ? `./${parts.slice(count).join("/")}` : ".";
  const directory = path.join(modules, name);
  const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  let target = manifest.exports?.[sub] ?? (sub === "." ? manifest.exports : undefined);
  if (target && typeof target === "object") target = target.import ?? target.default;
  if (!target && sub === ".") target = manifest.module ?? manifest.main ?? "index.js";
  if (!target) target = sub;
  return resolveFile(path.join(directory, target));
}

function resolveFile(base) {
  for (const candidate of [base, `${base}.js`, path.join(base, "index.js")])
    if (existsSync(candidate) && !candidate.endsWith(path.sep) && path.extname(candidate)) return candidate;
  throw new Error(`can't resolve ${base}`);
}

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

export async function sourceFiles(modules) {
  const seen = new Map();
  const queue = [];
  for (const [name, file] of ENTRIES) queue.push(path.join(modules, name, file));
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    const bytes = await readFile(file);
    seen.set(file, bytes);
    const source = stripComments(bytes.toString("utf8"));
    const specs = [...source.matchAll(IMPORT)].map((m) => m[1] ?? m[2]);
    specs.push(...[...source.matchAll(REQUIRE)].map((m) => m[1]));
    for (const spec of specs) {
      if (spec.startsWith("node:")) continue;
      queue.push(spec.startsWith(".") ? resolveFile(path.resolve(path.dirname(file), spec)) : await resolveBare(modules, spec));
    }
  }
  return [...seen]
    .map(([file, bytes]) => ({
      package: packageOf(modules, file),
      path: path.relative(path.join(modules, packageOf(modules, file)), file).split(path.sep).join("/"),
      bytes,
    }))
    .sort((a, b) => (a.package + a.path < b.package + b.path ? -1 : 1));
}
