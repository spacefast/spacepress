// Usage: node drive.mjs <store module> <script module>
// Loads a compiled client store with "@wordpress/interactivity" mapped to the fake, then runs the
// script's default export, which drives actions and prints observations as JSON.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === "@wordpress/interactivity") return { url: ${JSON.stringify(pathToFileURL(path.join(here, "fake-interactivity.mjs")).href)}, shortCircuit: true };
  return next(specifier, context);
}`));
const [storeFile, scriptFile] = process.argv.slice(2);
const fake = await import(pathToFileURL(path.join(here, "fake-interactivity.mjs")).href);
const script = await import(pathToFileURL(scriptFile).href);
await import(pathToFileURL(storeFile).href);
const out = await script.default(fake);
process.stdout.write(JSON.stringify(out));
