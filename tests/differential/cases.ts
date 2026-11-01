// Every action, access rule, and `.validate` closure here runs under Node and as compiled PHP;
// results must be identical. Add a case whenever the compiler learns a construct. Keep each one small.
import { collection, id, text, integer, defineConfig, action, json, group, repeater, blocks } from "zero";
import { job, jobs, once, env } from "zero"; // lane D

const n = collection("n", { id: id() }, { editor: false });

// Access rules run once per ctx below; validators once per value (with VALIDATE_CTX).
export const ACCESS_CTXS = [
  { user: null },
  { user: { id: 7, name: "Sub", role: "subscriber" } },
  { user: { id: 3, name: "Ed", role: "editor" }, data: { title: "Hi", ownerId: 3 } },
  { user: { id: 9, name: "Al", role: "author" }, data: { title: "", ownerId: 9 } },
  { user: { id: 1, name: "Root", role: "admin" }, data: { title: "Mine", ownerId: 1 } },
];
export const VALIDATE_VALUES = {
  "docs.title": ["Hello", "http://spam", "  ", "Ärtsoppa är god"],
  "docs.score": [0, 7, 11, 2.5],
  "docs.meta": [{ x: 1 }],
  "docs.info.meta": [{ x: 1 }],
  "docs.entries.meta": [{ x: 1 }],
  "docs.sections.hero.meta": [{ x: 1 }],
};
export const VALIDATE_CTX = { data: { title: "x", score: 1, info: { meta: { x: 0 } }, entries: [{ meta: { x: 0 } }], sections: [{ layout: "hero", meta: { x: 0 } }] }, user: { id: 1, name: "A", role: "admin" } };

const RANK = ["subscriber", "author", "editor", "admin"];

export const docs = collection("docs", {
  id: id(),
  title: text().notNull().validate((v): true | string => v.includes("http://") ? "No links" : v.trim().length > 0 || "blank"),
  score: integer().validate((v, ctx) => (v % 2 === 1 && ctx.user?.role === "admin" ? `odd ${v} for ${ctx.user?.name}` : undefined)),
  ownerId: integer(),
  meta: json().$type<{ x: number }>().validate((value, ctx) => { if (ctx.data.meta) ctx.data.meta.x = 7; return value.x === 7 || "root alias lost"; }),
  info: group({ fields: { meta: json().$type<{ x: number }>().notNull().validate((value, ctx) => { if (ctx.data.info) ctx.data.info.meta.x = 8; return value.x === 8 || "group alias lost"; }) } }),
  entries: repeater({ fields: { meta: json().$type<{ x: number }>().notNull().validate((value, ctx) => { const first = ctx.data.entries?.[0]; if (first) first.meta.x = 9; return value.x === 9 || "repeater alias lost"; }) } }),
  sections: blocks({ layouts: { hero: { meta: json().$type<{ x: number }>().notNull().validate((value, ctx) => { const first = ctx.data.sections?.[0]; if (first && first.layout === "hero") first.meta.x = 10; return value.x === 10 || "block alias lost"; }) } } }),
}, {
  title: "title",
  access: {
    read: (ctx) => ctx.user && ctx.user.role !== "subscriber" ? true : { status: "published" },
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { ownerId: ctx.user?.id ?? -1 },
    create: (ctx) => {
      if (!ctx.user) return false;
      if (RANK.indexOf(ctx.user.role) >= 2) return true;
      return (ctx.data?.title ?? "").length > 0 && ctx.data?.ownerId === ctx.user.id;
    },
    delete: (ctx) => ctx.user?.role === "admin",
  },
});

type Item = { name: string; qty: number; tags: string[] };
const ITEMS: Item[] = [
  { name: "Oat Milk", qty: 2, tags: ["dairy-free"] },
  { name: "eggs", qty: 0, tags: [] },
  { name: "Ärtsoppa", qty: 10, tags: ["soup", "swedish"] },
];

function fact(k: number): number {
  return k <= 1 ? 1 : k * fact(k - 1);
}

function label(i: Item): string {
  return `${i.name.trim()} (${i.qty})`;
}

function replacementOffset(match: string, offset: number, source: string): string {
  return `${match}:${offset}:${source}`;
}

function makeCounterReader(value: { count: number }) {
  value.count++;
  const forward = () => () => value.count;
  return forward();
}

const run = (handler: () => unknown) => action({ input: {}, handler });


// Each action is independent: Node shares one module; PHP starts a process per case.
const sharedCaptured = { n: 0 };
const capturedPairs = [sharedCaptured, sharedCaptured];
const capturedOther = { inner: sharedCaptured };
function refsRegistered(): number { return 1; }
function refsCollision(): number { return 2; }
function refsCollision_value(): number { return 3; }
function REFSCOLLISION_VALUE(): number { return 4; }
const laneRefs = {
  refsRegisteredRoot: action({ input: {}, handler: refsRegistered }),
  refsNamedWrappers: run(() => [refsRegistered === refsRegistered, [refsRegistered].includes(refsRegistered), refsCollision(), refsCollision_value(), REFSCOLLISION_VALUE()]),
  refsOptionalIndex: run(() => {
    let visited = 0;
    const readArray = (a: number[] | null) => a?.[visited++] ?? 99;
    const readRecord = (a: Record<string, number> | null) => a?.[(() => { visited++; return "x"; })()] ?? 99;
    return [readArray(null), readRecord(null), visited, readArray([7]), readRecord({ x: 8 }), visited];
  }),
  refsDestructureExhaustion: run(() => { const a = [1]; const [head, next = a.push(2, 3), last = 9, ...rest] = a; return [head, next, last, rest, a]; }),
  refsDestructureGrowth: run(() => { const a: number[] = []; const [next = a.push(2, 3), , last = 9, ...rest] = a; return [next, last, rest, a]; }),
  refsGuardedUpdates: run(() => { const bump = (o: { n: number | null; s: string | null }) => { if (o.n !== null) o.n++; if (o.n !== null) o.n += 2; if (o.s !== null) o.s += "b"; return [o.n, o.s]; }; return [bump({ n: 1, s: "a" }), bump({ n: null, s: null })]; }),
  refsCloneError: run(() => { const e = new Error("x"); const cloned = structuredClone([e, e]); return [cloned[0] === e, cloned[0] === cloned[1], cloned[0]!.message]; }),
  refsOnceError: run(async () => { const e = new Error("snapshot"); const first = await once("refs-error", () => e); const next = await once("refs-error", () => e); return [first === e, next === e, next.message]; }),
  refsOnceFunction: run(async () => { try { await once("refs-function", () => ({ f: refsRegistered })); return false; } catch { return true; } }),
  refsIndexStringCompound: run(() => { const a = ['a', 'b', 'c']; a[2] += 'x'; return a; }),
  refsIndexIncrement: run(() => { const a = [0, 1, 2, 3, 4, 5]; a[5]++; return a; }),
  refsIndexLogical: run(() => { const values = [true]; values[0] &&= true; return values; }),
  refsIndexMemberWrite: run(() => { const a = [{ x: 0 }, { x: 0 }, { x: 0 }]; a[2]!.x = 1; return a; }),
  refsObjectLoopBinding: run(() => { const fns: (() => number)[] = []; for (let s = { x: 0 }; s.x < 3; s.x++) fns.push(() => s.x); return fns.map(f => f()); }),
  refsCaptured: run(() => { capturedPairs[0]!.n = 7; return [capturedPairs[0] === capturedPairs[1], capturedOther.inner === sharedCaptured, capturedOther.inner.n]; }),
  refsCapturedOtherRoot: run(() => { capturedOther.inner.n = 9; return capturedPairs[1]!.n; }),
  refsCallbackArray: run(() => { const a = [1, 2]; return a.map((v, i, source) => { source[1] = 5; return [v, i, source === a]; }); }),
  refsOnceGraph: run(async () => { const p = { n: 1 }; const first = await once("refs-graph", () => p); first.n = 2; const second = await once("refs-graph", () => p); second.n = 3; const third = await once("refs-graph", () => p); return [first === p, first === second, third.n]; }),
  refs01: run(() => { const a = { x: 1 }; const b = a; b.x = 2; return a.x === 2; }),
  refs02: run(() => { const a = [1]; const b = a; b.push(2); return a.length === 2; }),
  refs03: run(() => { const o = { inner: { x: 1 } }; const { inner } = o; inner.x = 2; return o.inner.x === 2; }),
  refs04: run(() => { const list = [{ x: 1 }]; const f = list.find((e) => e.x === 1); if (f) f.x = 5; return list[0]?.x === 5; }),
  refs05: run(() => { const same = (v: { x: number }) => v; const a = { x: 1 }; const b = same(a); b.x = 2; return a.x === 2; }),
  refs06: run(() => { const a = { inner: { x: 1 } }; const b = { ...a }; b.inner.x = 2; return a.inner.x === 2; }),
  refs07: run(() => { const list = [{ x: 1 }]; list.forEach((e) => { e.x = 9; }); return list[0]?.x === 9; }),
  refs08: run(() => { const a: number[] = []; const box = { a }; a.push(1); return box.a.length === 1; }),
  refs09: run(() => { const a = [{ x: 1 }]; const e = a.at(0)!; e.x = 2; return a[0]!.x === 2; }),
  refs10: run(() => { const a = [{ x: 1 }]; const b = a.slice(); b[0]!.x = 2; return a[0]!.x === 2; }),
  refs11: run(() => { const a = { x: 1 }; const b = a; const change = () => { b.x = 2; }; change(); return a.x === 2; }),
  refs12: run(() => { const bump = (v: { x: number }) => { v.x++; }; const a = { x: 1 }; const b = a; bump(b); return a.x === 2; }),
  refs13: run(() => { const bump = (v: { x: number }) => { v.x++; }; const list = [{ x: 1 }]; list.forEach(bump); return list[0]!.x === 2; }),
  refs14: run(() => { const a = { x: 1 }; let b = a; if (a.x > 5) b = { x: 0 }; b.x = 2; return a.x === 2; }),
  refs15: run(() => { const a = { x: 1 }; let b = { x: 0 }; for (let i = 0; i < 2; i++) { b.x = 9; b = a; } return a.x === 9; }),
  refs16: run(() => { const keep = (v: number[]) => v; const a = [1]; const b = keep(a); a.push(2); return b.length === 2; }),
  refs17: run(() => { const read = (p: { x: number }) => { const q = p; p.x = 1; return q.x; }; return read({ x: 0 }) === 1; }),
  refs18: run(() => { const a = { x: 0 }; const f = () => { a.x++; }; const b = a; f(); return b.x === 1; }),
  refs19: run(() => { const a = [{ x: 0 }]; const b = a.map((e) => e); b[0]!.x = 1; return a[0]!.x === 1; }),
  refs20: run(() => { const a: { x: number }[] = []; a.push({ x: 0 }); const b = a[0]!; b.x = 1; return a[0]!.x === 1; }),
  refs21: run(() => { const a = { x: 0 }; const list = [a]; for (const item of list) item.x = 1; return a.x === 1; }),
  refs22: run(() => { const a = { x: 0 }; let b = a; try { JSON.parse('x'); } catch { b = { x: 9 }; } b.x = 1; return a.x === 1; }),
  refs23: run(() => { const a = { x: 0 }; let b = { x: 5 }; for (let i = 0; i < 2; i++) { b = a; if (i === 0) break; b = { x: 0 }; } b.x = 1; return a.x === 1; }),
  refs24: run(() => { const fs: (() => number)[] = []; for (let o = { x: 0 }; o.x < 1; o.x++) fs.push(() => o.x); return fs[0]!() === 1; }),
  refs25: run(() => { const o: { l: { x: number }, r: { x: number } } = { l: { x: 0 }, r: { x: 0 } }; o.r = o.l; o.l.x = 1; return o.r.x === 1; }),
  refs26: run(() => { const a = [{ x: 0 }]; const b = a.map((e) => e); a[0]!.x = 1; return b[0]!.x === 1; }),
  refs27: run(() => { const both = (a: { x: number }, b: { x: number }) => { a.x = 1; return b.x; }; const o = { x: 0 }; return both(o, o) === 1; }),
  refs28: run(() => { const a = [{ x: 0 }]; Array.from(a, (e) => { e.x = 1; return 0; }); return a[0]!.x === 1; }),
  refs29: run(() => { const a = [{ x: 0 }, { x: 0 }]; a.sort((x, y) => { y.x = 1; return 0; }); return a[0]!.x === 1; }),
  refs30: run(() => { const identity = (p: { x: number }) => p; const forward = (p: { x: number }) => identity(p); const o = { x: 0 }; const r = forward(o); o.x = 1; return r.x === 1; }),
  refs31: run(() => { const reader = (p: { x: number }) => () => p.x; const o = { x: 0 }; const r = reader(o); o.x = 1; return r() === 1; }),
  refs32: run(() => { const a = [{ x: 0 }]; const r = a.map((e) => { a[0]!.x = 1; return e.x; }); return r[0] === 1; }),
  refs33: run(() => { const a = [{ x: 0 }]; const b = a.map((e) => ({ e })); b[0]!.e.x = 1; return a[0]!.x === 1; }),
  refs34: run(() => { const cmp = (x: { x: number }, y: { x: number }) => { y.x = 1; return 0; }; const a = [{ x: 0 }, { x: 0 }]; a.sort(cmp); return a[1]!.x === 1; }),
  refs35: run(() => { const acc = (a: { x: number }, e: number) => { a.x += e; return a; }; const init = { x: 0 }; [1, 2].reduce(acc, init); return init.x === 3; }),
  refs36: run(() => { const reader = (p: { x: number }) => { const q = p; return () => q.x; }; const o = { x: 0 }; const r = reader(o); o.x = 1; return r() === 1; }),
  refs37: run(() => { const a = [1, 2]; (a.length > 0 ? a : a).reverse(); return a[0] === 2; }),
  refs38: run(() => { const wrap = (p: { x: number }) => ({ p }); const a = { x: 0 }; const b = wrap(a); a.x = 1; return b.p.x === 1; }),
  refs39: run(() => { const a = [{ x: 0 }]; const b = a.map((e) => ({ e })); a[0]!.x = 1; return b[0]!.e.x === 1; }),
  refs40: run(() => { const o = { x: 0 }; const f = (p: { x: number }) => { o.x = 1; return p.x; }; return f(o) === 1; }),
  refs41: run(() => { const a = [{ x: 0 }]; const b = Array.from(a, (e) => e); a[0]!.x = 1; return b[0]!.x === 1; }),
  refs42: run(() => { const rows = [{ x: 1 }]; const out: { x: number }[] = []; rows.forEach((r) => { out.push(r); }); out[0]!.x = 9; return rows[0]!.x === 9; }),
  refs43: run(() => { const rows = [{ x: 1 }]; const out = rows.reduce((acc, r) => { acc.push(r); return acc; }, [] as { x: number }[]); out[0]!.x = 9; return rows[0]!.x === 9; }),
  refs44: run(() => { const a = { x: 0 }; [a].map((e) => { e.x++; return e.x; }); return a.x === 1; }),
  refs45: run(() => { const r = [1].reduce((acc, n) => { const q = acc; acc.push(n); return q; }, [] as number[]); return r.length === 1; }),
  refs46: run(() => { const list = [{ x: 0 }, { x: 0 }]; list.reduce((acc, r) => { acc.x = 1; return r; }, { x: 0 }); return list[0]!.x === 1; }),
  refs47: run(() => { const reader = (p: { x: number }) => { const box = { p }; return () => box.p.x; }; const o = { x: 0 }; const f = reader(o); o.x = 1; return f() === 1; }),
  refs48: run(() => { const a = { x: 0 }; [{ child: a }].map((e) => { e.child.x = 1; return e; }); return a.x === 1; }),
  refs49: run(() => { const a = [{ x: 0 }]; const mutate = () => { a[0]!.x = 1; }; const r = a.map((e) => { mutate(); return e.x; }); return r[0] === 1; }),
  refs50: run(() => { const a = { x: 0 }; return ({ a, n: (a.x = 1) }).a.x === 1; }),
  refs51: run(() => { const reader = (p: { child: { x: number } }) => { const q = p.child; return (_: number) => q.x; }; const o = { child: { x: 0 } }; return reader(o)((o.child.x = 1)) === 1; }),
  refs52: run(() => { const a = [1, 2]; const r = a.map((e) => { a.reverse(); return e; }); return r[1] === 1; }),
  refs53: run(() => { return [{ x: 0 }].filter((e) => { e.x = 1; return true; })[0]!.x === 1; }),
  refs54: run(() => { const identity = (p: { x: number }) => p; const reader = (p: { x: number }) => { const q = identity(p); return () => q.x; }; const o = { x: 0 }; const f = reader(o); o.x = 1; return f() === 1; }),
  refs55: run(() => { const a = { x: 0 }; const r: [{ x: number }, number] = [a, a.x++]; return r[1] === 0; }),
  refs56: run(() => { const read = (p: { x: number }, n: number) => p.x; const a = { x: 0 }; return read(a, a.x++) === 1; }),
  refs57: run(() => { const a = [1, 2]; const cb = (e: number) => { a.reverse(); return e; }; return a.map(cb)[1] === 1; }),
  refs58: run(() => { const rows = [{ x: 1 }]; const keep: { x?: number }[] = []; rows.map((r) => { const o: { x?: number } = {}; keep.push(o); o.x = r.x; return o; }); return keep[0]!.x === 1; }),
  refs59: run(() => { const deep = (o: { inner: { x: number } }) => { o.inner.x = 1; }; const shared = { x: 0 }; const o = { inner: { x: 0 } }; o.inner = shared; deep(o); return shared.x === 1; }),
  refs60: run(() => { const a = { x: 0 }; let b = { x: 5 }; const f = () => { b = a; }; f(); b.x = 1; return a.x === 1; }),
  refs61: run(() => { const a = { child: { x: 0 } }; const b = { ...(a.child.x === 0 ? a : a) }; a.child.x = 1; return b.child.x === 1; }),
  refs62: run(() => { const shared = { x: 0 }; const list = [{ child: { x: 0 } }]; for (const e of list) { e.child = shared; e.child.x = 1; } return shared.x === 1; }),
  refs63: run(() => { const read = (p: { x: number }, q: { x: number }) => p.x + q.x; const a = { x: 0 }; let b = { x: 5 }; read(a, b = a); a.x = 1; return b.x === 1; }),
  refs64: run(() => { const a = [1, 2]; return a.slice(a.pop()! - 2).length === 1; }),
  refs65: run(() => { const a = { x: 0 }; let b = { x: 9 }; const dst: Record<string, number> = {}; dst[(b = a).x === 0 ? 'x' : 'x'] = (a.x = 1); return b.x === 1; }),
};

export default defineConfig({
  schema: { n, docs, fieldDocs: fieldDocs() },
  actions: {
    ...laneRefs,
    refsReceiver: run(() => {
      const old = { x: 0 }; const o = { child: old };
      const rhs = () => { o.child = { x: 9 }; return 2; };
      o.child.x = rhs(); return [old.x, o.child.x];
    }),
    refsLetReceiver: run(() => {
      let o = { x: 0 }; const old = o;
      const rhs = () => { o = { x: 9 }; return 2; };
      o.x = rhs(); return [old.x, o.x];
    }),
    refsSpreadSnapshot: run(() => {
      const a = { x: 1 }; const change = () => { a.x = 2; return 3; };
      return { ...a, y: change() };
    }),
    refsDestructureSnapshot: run(() => {
      let source: { x?: number; y: number } = { y: 1 };
      const change = () => { source = { y: 9 }; return 2; };
      const { x = change(), y } = source; return [x, y];
    }),
    refsConcatReceiver: run(() => {
      const a = [1]; const change = () => { a.push(2); return [3]; };
      return a.concat(change());
    }),
    refsCompoundOld: run(() => {
      const o = { x: 1 }; const change = () => { o.x = 10; return 2; };
      o.x += change(); return o.x;
    }),
    refsEqualityOrder: run(() => {
      let o = {}; const old = o; const change = () => { o = {}; return old; };
      return o === change();
    }),
    refsFlatMapSnapshot: run(() => {
      const first = [1]; return [0, 1].flatMap(i => { if (i === 0) return first; first[0] = 9; return [2]; });
    }),
    refsFindLastValue: run(() => {
      const a = [1, 2]; return a.findLast((v, i) => { a[i] = 9; return true; });
    }),
    refsLiveForOf: run(() => {
      const a = [1]; const out: number[] = [];
      for (const x of a) { out.push(x); if (x === 1) a.push(2); } return out;
    }),
    refsMapGrowth: run(() => { const a = [1, 2]; return a.map(x => { a.push(3); return x; }); }),
    refsMapWrite: run(() => { const a = [1, 2]; return a.map((x, i) => { a[1] = 9; return x; }); }),
    refsNamedIdentity: run(() => {
      const a = [1]; const alias = a; const o = { x: 1 };
      return [a === alias, a === [1], o === { x: 1 }, [o].includes(o), [o].includes({ x: 1 }), label === label, [label].includes(label)];
    }),
    refsKeyReceiver: run(() => {
      let o: Record<string, number> = { x: 1 }; const old = o;
      const key = () => { o = { x: 9 }; return 'x'; };
      return [o[key()], old.x, o.x];
    }),
    refsLogicalAssignment: run(() => { const o: { x?: number } = {}; let n = 0; const x = (o.x ??= (n = 1)); return [x, n, o.x]; }),
    refsStringAssignment: run(() => { const o = { s: 'a' }; o.s += 'b'; return o.s; }),
    refsShortCircuitWrite: run(() => { const o = { x: 1 }; const take = false; const result = take ? (o.x += 1) : 0; return [result, o.x, o.x += 1]; }),
    refsComputedKeys: run(() => { const o = { [1]: 'one', [false]: 'no', [null]: 'nil' }; return Object.entries(o); }),
    refsKeyOrder: run(() => {
      const a = { '1': 1, '0': 2, b: 3, '-1': 4 };
      const spread = { ...a };
      const reduced = Object.entries(a).reduce((acc, pair) => { acc[pair[0]!] = pair[1]!; return acc; }, {} as Record<string, number>);
      const entries = Object.fromEntries(Object.entries(a));
      return [a, spread, reduced, entries].map(o => [Object.keys(o), JSON.stringify(o)]).concat([[JSON.stringify(JSON.parse('{"1":1,"0":2,"b":3,"-1":4}'))]]);
    }),
    refsAppend: run(() => { const a = [1]; a[a.length] = 2; return a; }),
    refsFractionalRead: run(() => { const a = [1]; return [a[0.5] ?? null, a[-1] ?? null, a[NaN] ?? null]; }),
    refsCloneAlias: run(() => { const p = { x: 1 }; const copy = structuredClone([p, p]); copy[0]!.x = 9; return [copy[0] === copy[1], p.x, copy[1]!.x]; }),
    refsCycleJson: run(() => { const a: unknown[] = []; a.push(a); try { JSON.stringify(a); return false; } catch { return true; } }),
    refsCycleString: run(() => { const a: unknown[] = [1]; a.push(a); return String(a); }),
    refsArrayFromLive: run(() => { const a = [1, 2, 3]; return Array.from(a, x => { a.pop(); return x; }); }),
    refsArrayFromString: run(() => Array.from('a🙂b', (x, i) => `${i}:${x}`)),

    uriEncoding: run(() => {
      const values = ["https://mozilla.org/?x=шеллы", ";,/?:@&=+$#", "-_.!~*'()", "ABC abc 123", "é😀", "%20"];
      return values.map(value => [encodeURI(value), encodeURIComponent(value)]);
    }),
    hookCtx: action({ input: {}, handler: (_input, ctx) => [ctx.user?.name ?? "anonymous", ctx.user?.role ?? null] }),
    numbers: run(() => [0.1 + 0.2, 7 / 2, -7 % 3, 2 ** 10, 1 / 3, Math.max(1, 5, 3), Math.floor(-1.5), Math.round(2.5), Math.round(-2.5)]),
    // JS numbers are doubles: integer arithmetic past ±2^53 rounds, where PHP ints would stay exact.
    bigIntegers: run(() => {
      let i = 2 ** 53 - 1;
      const before = i++;
      const after = ++i;
      let j = -(2 ** 53) + 1;
      j -= 2;
      // Prefix/postfix on a key with a side effect evaluate the place once.
      const a: Record<string, number> = { k0: 10, k1: 20 };
      let k = 0;
      const pre = ++a["k" + k++]!;
      // Integer powers past 2^53 are doubles; exactly representable ones (2 ** 60) agree to the bit.
      let p = 2;
      p **= 60;
      const parsed = Number(JSON.parse("9007199254740993"));
      return [2 ** 53 + 1, 9007199254740993 + 0, 2 ** 53 * 3 + 1, before, after, i, j, Number("9007199254740993"), 7 - 10,
        pre, a, k, 2 ** 60 + 1, p, Math.pow(2, 60) - 1, 2 ** 0.5, 10 ** -2, parsed - 1];
    }),
    numberFormatting: run(() => [String(1e21), String(1e-7), String(123.456), String(-0), (1.005).toFixed(2), (2.5).toFixed(0)]),
    truthiness: run(() => ["", "0", 0, -0, null, [], {}].map((v) => (v ? "t" : "f")).join("")),
    stringLength: run(() => ["🙂".length, "héllo".length, "Ärtsoppa".length]),
    stringMethods: run(() => [
      "  Oat Milk ".trim(),
      "Oat Milk".toLowerCase(),
      "a,b,,c".split(","),
      "abc".slice(-2),
      "abcdef".substring(4, 1),
      "5".padStart(3, "0"),
      "x".repeat(3),
      "Hello World".replace(/o/g, "0"),
      "a-b-c".replaceAll("-", "+"),
      "aba".replaceAll("a", replacementOffset),
      "ab".replace(/b/, (match: string, offset: number, source: string) => `${match}:${offset}:${source}`),
      "ab".replace(/(a)?b/, (_match, capture: string | null, offset: number) => `${capture ?? "missing"}:${offset}`),
      "Oat Milk".includes("Milk"),
      "Oat Milk".indexOf("Milk"),
    ]),
    regex: run(() => [
      /^\d{4}-\d{2}-\d{2}$/.test("2026-10-28"),
      "Oat Milk & Eggs!".toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    ]),
    arrays: run(() => {
      const names = ITEMS.map((i) => i.name);
      const inStock = ITEMS.filter((i) => i.qty > 0).map((i) => i.name);
      const total = ITEMS.reduce((sum, i) => sum + i.qty, 0);
      const sorted = [10, 9, 1, 2].sort();
      const byQty = [...ITEMS].sort((a, b) => b.qty - a.qty).map((i) => i.name);
      const words = ["a"];
      words.push("b");
      words.unshift("c");
      const nested = { words: names.map(() => "a") };
      nested.words.push("b");
      let choice = total > 0 ? "a" : "b";
      choice = "c";
      const callback = ["a"].map(value => { value = "b"; return value; });
      const callbackDefaults = [{ value: undefined }].map(({ value = "a" }) => { value = "b"; return value; });
      let iteration = "";
      for (let value of ["a"]) { value = "b"; iteration += value; }
      const { words: defaults = ["a"] } = { words: undefined };
      defaults.unshift("b");
      let { value = "a" } = { value: undefined }; value = "b";
      let flag = true; flag = false;
      const flags = [true]; flags.push(false);
      let choose = () => true; choose = () => false;
      let label = () => "a"; label = () => "b";
      const predicates = [() => true]; predicates.push(() => false);
      const reduced = ["a"].reduce((acc, value) => acc + value);
      const reducedNested = [1].map(() => ["a"]).reduce((acc, value) => acc.concat(value));
      const readers = [{ count: 1 }, { count: 2 }].map(item => { item.count++; return () => item.count; });
      let missing: { count: number } | undefined = undefined;
      const mutate = (item: { count: number } = { count: 0 }) => { item.count++; return item.count; };
      const defaultCount = mutate(missing);
      const supplied = { count: 4 };
      const suppliedCount = mutate(supplied);
      const options: { item?: { count: number } } = { item: { count: 1 } };
      const tuple: [{ count: number }] = [{ count: 2 }];
      const emptyOptions: { item?: { count: number } } = {};
      const mutateWithExtra = (item: { count: number } = { count: 0 }, extra: number[] = []) => { item.count++; extra.push(item.count); return item.count; };
      const referenceArguments = {
        optional: mutate(options.item!),
        tuple: mutate(tuple[0]!),
        optionalSource: options.item?.count,
        tupleSource: tuple[0]?.count,
        missing: mutate(emptyOptions.item),
        missingKeys: Object.keys(emptyOptions),
        unpacked: mutateWithExtra(options.item!, []),
        unpackedMissing: mutateWithExtra(emptyOptions.item, []),
        unpackedMissingKeys: Object.keys(emptyOptions),
      };
      let item = { count: 1 };
      const readItem = makeCounterReader(item);
      const readBinding = () => item.count;
      const spread = { ...item };
      const { ...rest } = item;
      item.count++;
      const live = readItem();
      item = { count: 9 };
      let absent: { count: number } | null = null;
      const makeNullable = (value: { count: number } | null) => { if (value !== null) value.count++; return () => value?.count ?? null; };
      const readAbsent = makeNullable(absent);
      absent = { count: 9 };
      const accumulatorReaders: (() => number)[] = [];
      [1, 2].reduce((acc, value) => { acc.count++; accumulatorReaders.push(() => acc.count); return { count: acc.count }; }, { count: 0 });
      const sharedReaders: (() => number)[] = [];
      [1, 2].reduce((acc, value) => { acc.count++; sharedReaders.push(() => acc.count); return acc; }, { count: 0 });
      const loopReaders: (() => number)[] = [];
      const localReaders: (() => number)[] = [];
      const loopItems = [{ count: 1 }, { count: 2 }];
      for (const item of loopItems) {
        item.count++;
        loopReaders.push(() => item.count);
        let local = item.count;
        localReaders.push(() => local);
        local++;
        continue;
      }
      return { names, inStock, total, sorted, byQty, words, nested, choice, callback, callbackDefaults, iteration, defaults, value, flag, flags, chosen: choose(), label: label(), predicates: predicates.map(predicate => predicate()), reduced, reducedNested, readers: readers.map(read => read()), defaultCount, missing: missing === undefined, suppliedCount, supplied: supplied.count, referenceArguments, escaped: readItem(), binding: readBinding(), live, absent: readAbsent(), spread: spread.count, rest: rest.count, accumulatorReaders: accumulatorReaders.map(read => read()), sharedReaders: sharedReaders.map(read => read()), loopReaders: loopReaders.map(read => read()), loopSource: loopItems.map(item => item.count), localReaders: localReaders.map(read => read()), some: ITEMS.some((i) => i.qty === 0), idx: ITEMS.findIndex((i) => i.name === "eggs") };
    }),
    objects: run(() => {
      const base = { a: 1, b: 2 };
      const merged = { ...base, b: 3, c: 4 };
      const { a, ...rest } = merged;
      return { merged, a, rest, keys: Object.keys(merged), entries: Object.entries(base) };
    }),
    control: run(() => {
      let out = "";
      for (const x of [1, 2, 3, 4]) {
        switch (x) {
          case 2:
            continue;
          case 4:
            out += "!";
            break;
          default:
            out += String(x);
        }
        out += ".";
      }
      let i = 0;
      while (i < 3) i++;
      return { out, i };
    }),
    recursion: run(() => [fact(5), fact(1)]),
    nullish: run(() => {
      const maybe: string | null = ITEMS[1]!.tags.length > 0 ? "x" : null;
      const message = (flag: boolean): false | string => {
        let result: boolean | string = flag;
        return result &&= "present";
      };
      const fallback = (flag: boolean): true | string => {
        let result: boolean | string = flag;
        return result ||= "error";
      };
      const yes = (): true => !0;
      const no = (): false => !1;
      let negated = !false; negated = !true;
      let template = `a`; template = `b`;
      return [maybe ?? "none", maybe?.length ?? -1, ITEMS[0]!.tags[0] ?? "?", ITEMS[1]!.tags[0] ?? "?", message(false), message(true), fallback(false), fallback(true), negated, yes(), no(), !-0, !-1, template];
    }),
    templates: run(() => ITEMS.map(label)),
    templateTernary: run(() => ITEMS.map((i) => `${i.qty > 0 ? i.name : "none"}!` + (i.qty > 5 ? " lots" : ""))),
    closures: run(() => {
      let count = 0;
      const bump = () => {
        count += 1;
        return count;
      };
      bump();
      bump();
      return count;
    }),
    json: run(() => [JSON.stringify({ a: [1, 2.5, "x"], b: null }), JSON.stringify(1.0), JSON.parse('{"k":[1,2]}')]),
    // `{}` stays an object (PHP's [] is also the empty list): literals, parsed JSON, filled and spread.
    emptyObjects: run(() => {
      const o: Record<string, number> = {};
      const a: number[] = [];
      const filled: Record<string, number> = {};
      filled.k = 1;
      const copy = { ...o };
      const parsed = JSON.parse('{"x":{},"y":[]}');
      // Target keys, then the right side, then the write: the right side still sees the empty object.
      const self: Record<string, string> = {};
      self.x = JSON.stringify(self);
      const keyed: Record<string, number> = {};
      let i = 0;
      keyed["k" + i++] = i;
      const lazy: Record<string, string> = {};
      lazy.x ??= JSON.stringify(lazy);
      const deep: { a: Record<string, number> } = { a: {} };
      deep.a.b = 5;
      deep.a.b += 2;
      let j = 0;
      const once: Record<string, number> = {};
      once["k" + j++] ??= j;
      const text: { s: string } = { s: "a" };
      const joined = (text.s += "b") + 1;
      const indexed = ({} as Record<string, number>)["x"] ?? -1;
      // A short-circuited logical assignment leaves the place untouched (no key appears).
      const skipped: { x?: string; y?: string; z?: string } = {};
      skipped.x &&= "a";
      skipped.y ||= "b";
      skipped.y ||= "c";
      return [JSON.stringify({ o, a, n: null }), JSON.stringify(filled), Object.keys(o), JSON.stringify(copy), JSON.stringify(parsed), o, self, keyed, lazy, deep, once, j, joined, text, indexed, JSON.stringify(skipped)];
    }),
    errors: run(() => {
      try {
        throw new Error("boom");
      } catch (e) {
        return "caught";
      }
    }),
    thrown: run(() => {
      throw new Error("expected failure");
    }),
    ...laneDActions(),
    ...laneSActions(),
  },
  jobs: laneDJobs(),
});

// ---- lane D: jobs, once(), env() (phase 2 §6.1). The Node shim keeps once() receipts and pending
// enqueue keys in memory; PHP keeps them in __zero_receipts and the outbox. Keys are unique per case.
function laneDJobs() {
  return { ping: job({ input: { note: text() }, handler: async () => {} }) };
}

function laneDActions() {
  return {
    onceReplays: action({ input: {}, handler: async () => {
      let runs = 0;
      const first = await once("lane-d-replay", async () => { runs++; return { n: runs, tags: ["a"], extra: {} }; });
      const second = await once("lane-d-replay", () => { runs++; return { n: runs, tags: ["b"], extra: {} }; });
      const other = await once("lane-d-other", () => { runs++; return runs; });
      return { first, second, other, runs };
    } }),
    onceRegex: action({ input: {}, handler: async () => {
      const first = await once("lane-d-regex", () => /^a+$/i);
      const replay = await once("lane-d-regex", () => /never/);
      return [first.test("AAA"), replay.test("AAA"), replay.test("b")];
    } }),
    onceNull: action({ input: {}, handler: async () => [await once("lane-d-null", () => null), await once("lane-d-null", () => "second")] }),
    enqueueIds: action({ input: {}, handler: async () => {
      const plain = await jobs.ping.enqueue({ note: "hi" });
      const keyed = await jobs.ping.enqueue({ note: "x" }, { key: "lane-d", delay: 5 });
      const same = await jobs.ping.enqueue({ note: "y" }, { key: "lane-d" });
      return [plain.id.length, keyed.id === same.id, plain.id === keyed.id];
    } }),
    envRead: action({ input: {}, handler: () => [env("ZERO_LANE_D_UNSET") ?? "unset", typeof env("PATH")] }),
  };
}

// ---- lane S: string units, positions and loop closures. JS counts strings in UTF-16 code
// units and gives each `for (let ...)` iteration its own binding; compiled PHP must agree.
function laneSActions() {
  return {
    loopClosures: run(() => {
      const fs: (() => number)[] = [];
      for (let i = 0; i < 3; i++) fs.push(() => i);
      return fs.map((f) => f());
    }),
    loopPatternClosures: run(() => {
      const fs: (() => number)[] = [];
      for (let { i } = { i: 0 }; i < 3; i++) fs.push(() => i);
      return fs.map((f) => f());
    }),
    // A closure made in the initializer keeps the initializer's binding, not the first iteration's.
    initializerClosure: run(() => {
      let seen = -1;
      for (let { i, read = () => i }: { i: number; read?: () => number } = { i: 0 }; i < 1; i++) {
        i = 5;
        seen = read();
      }
      return seen;
    }),
    // A captured primitive loop binding of any kind (here a string) gets its own per-iteration cell.
    stringLoopClosures: run(() => {
      const fns: (() => string)[] = [];
      for (let s = "a"; s.length < 4; s += "a") fns.push(() => s);
      return fns.map((f) => f());
    }),
    // String lastIndexOf reads an undefined position as omitted and null as 0; the rest read both
    // as 0.
    nullishPositions: run(() => ["ab".lastIndexOf("b", undefined), "ab".lastIndexOf("b", 0), "ab".lastIndexOf("b", -1), "ab".lastIndexOf("b", null as unknown as number), [1, 2].lastIndexOf(2, undefined), [1, 2].includes(1, null as unknown as number), "ab".at(undefined as unknown as number), [1, 2].at(null as unknown as number), "ab".indexOf("b", undefined)]),
    arrayFromIndex: run(() => [[1, 2].includes(1, 1), [1, 2].includes(2, -1), [1, 2, 1].lastIndexOf(1, 1), [1, 2, 1].lastIndexOf(1, -2), [1, 2].includes(1, 5), [1].lastIndexOf(1, -1e300), [1].lastIndexOf(1, -1e20), [1, 2].includes(1, -1e300), [1, 2, 1].lastIndexOf(1, 1e300)]),
    utf16Units: run(() => {
      const s = "\u{1F600}a\u00e9";
      return [s.length, s[2.5] ?? "missing", s.indexOf("a"), s.lastIndexOf("\u00e9"), s.slice(2), s.substring(0, 2), s.charAt(2), s.at(-1), s.padStart(6, "-"), s.padEnd(5, "."), s.replace("a", (m, at: number) => `${m}@${at}`)];
    }),
  };
}

// ---- lane B: field access (phase 2 §4). A field rule compiles through the access-fn path; data is
// the row on read, the incoming data on create/update, the enclosing item for sub-fields.
export const FIELD_CTXS = [
  { user: null, data: { ownerId: 1, salary: 10 } },
  { user: { id: 1, name: "Owner", role: "author" }, data: { ownerId: 1, salary: 10 } },
  { user: { id: 2, name: "Other", role: "author" }, data: { ownerId: 1, salary: null } },
  { user: { id: 3, name: "Ed", role: "editor" }, data: { ownerId: 1, salary: 5 } },
];

// A hoisted function, so the collection can live in this block below the default export.
function fieldDocs() {
  return collection("fieldDocs", {
    id: id(),
    ownerId: integer(),
    salary: integer().access({
      read: (ctx) => ctx.user !== null && (RANK.indexOf(ctx.user.role) >= 2 || ctx.data.ownerId === ctx.user.id),
      update: (ctx) => ctx.user?.role === "admin" || (ctx.data.salary !== null && ctx.op === "update"),
    }),
  }, { editor: false });
}

