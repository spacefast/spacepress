// Host-API probes. The syntax pass stops the files-sdk build at its first
// layer, so these show what's next: one tiny app per API, each compiled twice,
// as authored TypeScript in zero.config.ts and as an imported JavaScript package
// (the way files-sdk's own code reaches the compiler). A probe passes when
// `zero check` reports no diagnostics.
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// [name, typed TS body, JS body]. Each body returns a string, number or boolean.
export const PROBES = [
  ["Symbol", 'const k = Symbol("k"); return String(k.description) + typeof k;', 'const k = Symbol("k"); return String(k.description) + typeof k;'],
  ["Symbol.for / well-known", 'return Symbol.for("a") === Symbol.for("a") && typeof Symbol.iterator === "symbol";', 'return Symbol.for("a") === Symbol.for("a") && typeof Symbol.iterator === "symbol";'],
  ["WeakMap", "const k = {}; const m = new WeakMap<object, number>(); m.set(k, 1); return m.get(k) ?? 0;", "const k = {}; const m = new WeakMap(); m.set(k, 1); return m.get(k);"],
  ["globalThis", 'return typeof globalThis.fetch;', 'return typeof globalThis.fetch;'],
  ["Promise.all", "const r = await Promise.all([Promise.resolve(1), Promise.resolve(2)]); return r.length;", "return Promise.all([Promise.resolve(1), Promise.resolve(2)]).then((r) => r.length);"],
  ["new Promise", "const v = await new Promise<number>((resolve) => resolve(3)); return v;", "return new Promise((resolve) => resolve(3));"],
  ["for await", "let n = 0; for await (const x of [1, 2]) n += x; return n;", "return (async () => { let n = 0; for await (const x of [1, 2]) n += x; return n; })();"],
  ["async generator", "async function* g() { yield 1; yield 2; } let n = 0; for await (const x of g()) n += x; return n;", "async function* g() { yield 1; yield 2; } return (async () => { let n = 0; for await (const x of g()) n += x; return n; })();"],
  ["generator", "function* g() { yield 1; yield 2; } let n = 0; for (const x of g()) n += x; return n;", "function* g() { yield 1; yield 2; } let n = 0; for (const x of g()) n += x; return n;"],
  ["URL", 'return new URL("https://x.test/a?b=1").pathname;', 'return new URL("https://x.test/a?b=1").pathname;'],
  ["AbortController", "const c = new AbortController(); c.abort(); return c.signal.aborted;", "const c = new AbortController(); c.abort(); return c.signal.aborted;"],
  ["ReadableStream", "const s = new ReadableStream<Uint8Array>({ start(c) { c.close(); } }); return typeof s;", "const s = new ReadableStream({ start(c) { c.close(); } }); return typeof s;"],
  ["Blob", 'return new Blob(["ab"]).size;', 'return new Blob(["ab"]).size;'],
  ["TextEncoder / Uint8Array", 'return new TextEncoder().encode("é").length;', 'return new TextEncoder().encode("é").length;'],
  ["Response / Headers", 'const h = new Headers(); h.set("a", "b"); return h.get("a") ?? "";', 'const h = new Headers(); h.set("a", "b"); return h.get("a");'],
  ["setTimeout", "await new Promise<void>((r) => setTimeout(r, 1)); return 1;", "return new Promise((r) => setTimeout(() => r(1), 1));"],
  ["Map / Set", 'const m = new Map<string, number>([["a", 1]]); const s = new Set<number>([1]); return (m.get("a") ?? 0) + s.size;', 'const m = new Map([["a", 1]]); const s = new Set([1]); return m.get("a") + s.size;'],
  ["private fields", "class A { #x = 1; #y() { return this.#x; } get() { return this.#y(); } } return new A().get();", "class A { #x = 1; #y() { return this.#x; } get() { return this.#y(); } } return new A().get();"],
  ["class extends Error", 'class E extends Error { code = "c"; } let caught = false; try { throw new E("m"); } catch (e) { caught = e instanceof E; } return caught;', 'class E extends Error { constructor(m) { super(m); this.code = "c"; } } try { throw new E("m"); } catch (e) { return e instanceof E; }'],
  ["class inside a function", "function make() { class A { v() { return 1; } } return new A(); } return make().v();", "function make() { class A { v() { return 1; } } return new A(); } return make().v();"],
];

const config = (body) => `import { action, defineConfig, text } from "zero";
${body.imports ?? ""}
export default defineConfig({ name: "probe", actions: { a: action({ access: "anyone", input: { s: text().notNull() }, async handler(input) {
${body.handler}
} }) } });
`;

function verdict(zero, dir) {
  const out = spawnSync(zero, ["check", dir, "--json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(out.stdout);
  } catch {
    return { ok: false, first: (out.stderr || "no JSON").trim().split("\n")[0] };
  }
  if (report.ok) return { ok: true, first: "" };
  const d = report.diagnostics[0];
  return { ok: false, first: d ? `${d.code} ${d.message}` : "failed without diagnostics" };
}

export async function runProbes(zero, work) {
  await rm(work, { recursive: true, force: true });
  const rows = [];
  for (const [index, [name, ts, js]] of PROBES.entries()) {
    const tsDir = path.join(work, `${index}-ts`);
    await mkdir(tsDir, { recursive: true });
    // The body runs directly in the handler, so only the API itself is measured.
    await writeFile(
      path.join(tsDir, "zero.config.ts"),
      config({ handler: ts.replace(/return ([^;]+);(?![\s\S]*return )/, "return { v: String($1) };") }),
    );
    const jsDir = path.join(work, `${index}-js`);
    await mkdir(path.join(jsDir, "node_modules/probe-lib"), { recursive: true });
    await writeFile(path.join(jsDir, "node_modules/probe-lib/package.json"), '{"name":"probe-lib","type":"module","exports":"./index.js"}');
    await writeFile(path.join(jsDir, "node_modules/probe-lib/index.js"), `export function run(s) { ${js} }\n`);
    await writeFile(
      path.join(jsDir, "zero.config.ts"),
      config({
        imports: 'import { run } from "probe-lib";',
        handler: /Promise|async|setTimeout/.test(js)
          ? "return { v: String(await run(input.s)) };"
          : "return { v: String(run(input.s)) };",
      }),
    );
    rows.push({ name, ts: verdict(zero, tsDir), js: verdict(zero, jsDir) });
  }
  return rows;
}

const cell = (text) => text.replaceAll("|", "\\|").replaceAll("\n", " ").slice(0, 110);

export function probeTable(rows) {
  const lines = ["| host API | typed TS | imported JS | first diagnostic |", "| --- | --- | --- | --- |"];
  for (const { name, ts, js } of rows) {
    const first = [...new Set([ts.first, js.first].filter(Boolean))].map(cell).join(" / ");
    lines.push(`| ${name} | ${ts.ok ? "ok" : "refused"} | ${js.ok ? "ok" : "refused"} | ${first} |`);
  }
  const pass = (key) => rows.filter((row) => row[key].ok).length;
  lines.push(`| **total** | **${pass("ts")}/${rows.length}** | **${pass("js")}/${rows.length}** | |`);
  return lines.join("\n");
}
