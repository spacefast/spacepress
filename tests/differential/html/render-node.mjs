// Usage: node render-node.mjs <project dir> <cases.json>
// Renders every case with React 19 (react-dom/static prerender, which accepts async server
// components) and prints {"<index>": {"html": …} | {"error": message}} for tests/compiler.rs.
// esbuild compiles the TSX with React's automatic runtime, exactly as a React app would.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { prerender } from "react-dom/static";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [project, casesFile] = process.argv.slice(2);
const cases = JSON.parse(readFileSync(casesFile, "utf8"));
const here = path.dirname(new URL(import.meta.url).pathname);
const files = [...new Set(cases.map((c) => c.component.split("#")[0]))];
const result = await build({
  entryPoints: files.map((f) => path.join(project, "first", f)),
  outdir: path.join(here, ".out"),
  outbase: path.join(project, "first"),
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  alias: { "first/client": path.join(here, "first-client.mjs") },
  write: true,
  logLevel: "silent",
});
if (result.errors.length) throw new Error(JSON.stringify(result.errors));
const decoder = new TextDecoder();
const out = {};
// React's development warnings (controlled inputs without onChange) aren't output.
console.error = () => {};
for (const [index, { component, props }] of cases.entries()) {
  const [file, name] = component.split("#");
  const mod = await import(pathToFileURL(path.join(here, ".out", file.replace(/\.tsx$/, ".js"))).href);
  try {
    const { prelude } = await prerender(createElement(mod[name], props));
    let html = "";
    for await (const chunk of prelude) html += decoder.decode(chunk, { stream: true });
    out[index] = { html };
  } catch (e) {
    out[index] = { error: e.message };
  }
}
process.stdout.write(JSON.stringify(out));
