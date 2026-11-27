// Usage: node run-node.mjs <config.ts>
// Prints a versioned completion envelope containing {"<case>": {"data": ...} | {"error": message}} for every action (called with
// input {} and HookCtx CTXS.hook) and every collection access rule, column `.access` rule and
// `.validate` closure (called with each fake ctx in ACCESS_CTXS / FIELD_CTXS / each value in VALUES).
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(new URL("./resolve-spacepress.mjs", import.meta.url));
const { once, transaction } = await import("./spacepress-shim.mjs");
const mod = await import(pathToFileURL(process.argv[2]).href);
// Kinds and actions register by export name, as the compiler reads them (docs/spec/spec.md §1.1).
const exported = (what) => Object.fromEntries(Object.entries(mod).filter(([, v]) => v?.$first === what));
const out = {};
const run = async (name, fn) => {
  try {
    out[name] = { data: (await fn()) ?? null };
  } catch (e) {
    out[name] = { error: e.message };
  }
};
const hookCtx = { user: null, once };
for (const [name, a] of Object.entries(exported("action"))) {
  await run(name, () => transaction(() => a.handler(hookCtx, {})));
}
function* columns(fields, prefix = [], dataPath = []) {
  for (const [name, b] of Object.entries(fields)) {
    const key = [...prefix, name], path = [...dataPath, name];
    yield { col: key.join("."), b, path };
    const meta = b.$meta;
    if (meta.fields) yield* columns(meta.fields, key, meta.kind === "repeater" ? [...path, 0] : path);
    for (const [layout, children] of Object.entries(meta.layouts ?? {})) yield* columns(children, [...key, layout], [...path, 0]);
  }
}
for (const [name, c] of Object.entries(exported("kind"))) {
  for (const [op, rule] of Object.entries(c.options?.access ?? {})) {
    if (typeof rule !== "function") continue;
    for (const [i, ctx] of (mod.ACCESS_CTXS ?? []).entries()) {
      await run(`access:${name}:${op}:${i}`, () => rule({ ...ctx, op }));
    }
  }
  for (const { col, b, path } of columns(c.cols)) {
    for (const [op, rule] of Object.entries(b.$meta?.access ?? {})) {
      if (typeof rule !== "function") continue;
      for (const [i, ctx] of (mod.FIELD_CTXS ?? []).entries()) {
        await run(`field:${name}:${col}:${op}:${i}`, () => rule({ ...ctx, op }));
      }
    }
    const v = b.$meta?.validate;
    if (!v) continue;
    for (const [i, value] of (mod.VALIDATE_VALUES?.[`${name}.${col}`] ?? []).entries()) {
      await run(`validate:${name}:${col}:${i}`, () => {
        const ctx = structuredClone(mod.VALIDATE_CTX);
        let container = ctx.data;
        for (const key of path.slice(0, -1)) container = container[key];
        container[path.at(-1)] = structuredClone(value);
        return v(container[path.at(-1)], ctx);
      });
    }
  }
}
if (Object.keys(out).length === 0) throw new Error("differential oracle executed no cases");
process.stdout.write(JSON.stringify({ schema: "spacepress-differential", version: 1, complete: true, cases: out }));
