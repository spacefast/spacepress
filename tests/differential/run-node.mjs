// Usage: node run-node.mjs <config.ts>
// Prints a versioned completion envelope containing {"<case>": {"data": ...} | {"error": message}} for every action (called with
// input {} and HookCtx CTXS.hook) and every collection access rule, column `.access` rule and
// `.validate` closure (called with each fake ctx in ACCESS_CTXS / FIELD_CTXS / each value in VALUES).
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
const hookCtx = { user: null };
for (const [name, a] of Object.entries(config.actions ?? {})) {
  await run(name, () => a.handler({}, hookCtx));
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
for (const c of Object.values(config.schema ?? {})) {
  for (const [op, rule] of Object.entries(c.options?.access ?? {})) {
    if (typeof rule !== "function") continue;
    for (const [i, ctx] of (mod.ACCESS_CTXS ?? []).entries()) {
      await run(`access:${c.name}:${op}:${i}`, () => rule({ ...ctx, op }));
    }
  }
  for (const { col, b, path } of columns(c.cols)) {
    for (const [op, rule] of Object.entries(b.$meta?.access ?? {})) {
      if (typeof rule !== "function") continue;
      for (const [i, ctx] of (mod.FIELD_CTXS ?? []).entries()) {
        await run(`field:${c.name}:${col}:${op}:${i}`, () => rule({ ...ctx, op }));
      }
    }
    const v = b.$meta?.validate;
    if (!v) continue;
    for (const [i, value] of (mod.VALIDATE_VALUES?.[`${c.name}.${col}`] ?? []).entries()) {
      await run(`validate:${c.name}:${col}:${i}`, () => {
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
process.stdout.write(JSON.stringify({ schema: "zero-differential", version: 1, complete: true, cases: out }));
