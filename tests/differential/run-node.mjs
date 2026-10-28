// Usage: node run-node.mjs <config.ts>  → prints {"<action>": {"data": ...} | {"error": message}} as JSON.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(new URL("./resolve-zero.mjs", import.meta.url));
const config = (await import(pathToFileURL(process.argv[2]).href)).default;
const out = {};
for (const [name, a] of Object.entries(config.actions ?? {})) {
  try {
    out[name] = { data: await a.handler({}) };
  } catch (e) {
    out[name] = { error: e.message };
  }
}
process.stdout.write(JSON.stringify(out));
