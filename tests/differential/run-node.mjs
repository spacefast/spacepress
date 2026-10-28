// Usage: node run-node.mjs <config.ts>
// Prints {"<case>": {"data": ...} | {"error": message}} as JSON for every action (called with
// input {} and HookCtx CTXS.hook) and every collection access rule and `.validate` closure
// (called with each fake ctx in CTXS / each value in VALUES exported by the config).
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(new URL("./resolve-zero.mjs", import.meta.url));
const mod = await import(pathToFileURL(process.argv[2]).href);
const config = mod.default;
const out = {};
const run = async (name, fn) => {
  try {
    out[name] = { data: (await fn()) ?? null };
  } catch (e) {
    out[name] = { error: e.message };
  }
};
const hookCtx = { user: null, target: "standalone" };
for (const [name, a] of Object.entries(config.actions ?? {})) {
  await run(name, () => a.handler({}, hookCtx));
}
for (const c of Object.values(config.schema ?? {})) {
  for (const [op, rule] of Object.entries(c.options?.access ?? {})) {
    if (typeof rule !== "function") continue;
    for (const [i, ctx] of (mod.ACCESS_CTXS ?? []).entries()) {
      await run(`access:${c.name}:${op}:${i}`, () => rule({ ...ctx, op }));
    }
  }
  for (const [col, b] of Object.entries(c.cols)) {
    const v = b.$meta?.validate;
    if (!v) continue;
    for (const [i, value] of (mod.VALIDATE_VALUES?.[`${c.name}.${col}`] ?? []).entries()) {
      await run(`validate:${c.name}:${col}:${i}`, () => v(value, mod.VALIDATE_CTX));
    }
  }
}
process.stdout.write(JSON.stringify(out));
