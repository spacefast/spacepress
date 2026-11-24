// Usage: node drive.mjs <store module> <script module> [<typed client module>]
// Loads a compiled client store with "@wordpress/interactivity" mapped to the fake (and
// "@typedpress/client" to the app's built client, when given), then runs the script's default
// export, which drives actions and prints observations as JSON.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const [storeFile, scriptFile, clientFile] = process.argv.slice(2);
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === "@wordpress/interactivity") return { url: ${JSON.stringify(pathToFileURL(path.join(here, "fake-interactivity.mjs")).href)}, shortCircuit: true };
  if (specifier === "@typedpress/client" && ${JSON.stringify(clientFile ?? null)}) return { url: ${JSON.stringify(clientFile ? pathToFileURL(clientFile).href : "")}, shortCircuit: true };
  return next(specifier, context);
}`));
const fake = await import(pathToFileURL(path.join(here, "fake-interactivity.mjs")).href);
const script = await import(pathToFileURL(scriptFile).href);
await import(pathToFileURL(storeFile).href);
const out = await script.default(fake);
process.stdout.write(JSON.stringify(out));
