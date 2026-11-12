// Every action, access rule, and `.validate` closure here runs under Node and as compiled PHP;
// results must be identical. Add a case whenever the compiler learns a construct. Keep each one small.
import { collection, text, integer, defineConfig, action, json, group, repeater, blocks , table} from "first";
import { job, jobs, once } from "first"; // lane D
import * as ns from "./namespace.mjs";
import picoish from "./namespace.mjs";
import { jsAbort, jsCollections, jsTimers } from "./stdlib.js";

const n = table({  });

// These named helpers have enforced PHP object parameters. Alias mutation and missing
// properties must keep their JavaScript behavior when reads/writes use native PHP.
function nativeParameter(input: { n: number; label: string | null; optional?: string }) {
  const alias = input;
  alias.n = 4;
  const assigned = (input.n = input.n + 1);
  input.n += 2;
  const old = input.n++;
  return [assigned, old, input.n, input.label, input.optional ?? "absent"];
}
function nativeMissing(input: { n: number }) {
  const before = input.n;
  input.n += 1;
  return [before, input.n];
}
function reboundParameter(input: { n: number }) {
  const replace = () => { input = { n: 9 }; };
  replace();
  input.n = 10;
  return input.n;
}
function nullableParameter(input: { n: number } | null) {
  return input ? input.n : "null";
}

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
const NUMBER_IS_FINITE = Number.isFinite;
const FINITE_VALUES = [NaN, Infinity, -Infinity, 0, "3", "", null, false, [], [3], [false]];
const PURE_FINITE = FINITE_VALUES.map(value => [Number.isFinite(value), isFinite(value)]);

export const docs = collection({
  title: text().validate((v): true | string => v.includes("http://") ? "No links" : v.trim().length > 0 || "blank"),
  score: integer().validate((v, ctx) => (v % 2 === 1 && ctx.user?.role === "admin" ? `odd ${v} for ${ctx.user?.name}` : undefined)).optional(),
  ownerId: integer().optional(),
  meta: json<{ x: number }>().validate((value, ctx) => { if (ctx.data.meta) ctx.data.meta.x = 7; return value.x === 7 || "root alias lost"; }).optional(),
  info: group({ meta: json<{ x: number }>().validate((value, ctx) => { if (ctx.data.info) ctx.data.info.meta.x = 8; return value.x === 8 || "group alias lost"; }) }).optional(),
  entries: repeater({ meta: json<{ x: number }>().validate((value, ctx) => { const first = ctx.data.entries?.[0]; if (first) first.meta.x = 9; return value.x === 9 || "repeater alias lost"; }) }).optional(),
  sections: blocks({ hero: { meta: json<{ x: number }>().validate((value, ctx) => { const first = ctx.data.sections?.[0]; if (first && first.layout === "hero") first.meta.x = 10; return value.x === 10 || "block alias lost"; }) } }).optional(),
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
type Candidate = { kind: string; label?: string };
type Named = Candidate & { kind: "named"; label: string };
function isNamed(item: Candidate): item is Named {
  return item.kind === "named" && typeof item.label === "string";
}
function guardedLabel(item: Candidate | undefined): string {
  if (!item || !isNamed(item)) return "";
  return item.label;
}
function scalarLabel(value: unknown): string {
  if (typeof value === "number") return String(value + 1);
  if ("string" === typeof value && value.trim() !== "") return value.toUpperCase();
  if (typeof value !== "boolean") return "other";
  return value ? "true" : "false";
}
function scalarRemainder(value: number | string | null): string {
  if (typeof value === "number") return String(value - 1);
  if (typeof value !== "string") return "absent";
  return value.toLowerCase();
}

function varParameter(value: number): number {
  var value;
  return value;
}

function uncheckedText(value: unknown, texts: string[]): string {
  const first = Array.from(["x"]);
  const definite: string = value + first[0];
  return "p" + (value + texts[3]) + (value + texts[0]) + (texts[0] + value) + definite;
}

function varSemantics(seed: number) {
  const before = typeof later;
  const beforeValue = later;
  var later: number = seed;
  var later;
  if (seed < 0) {
    var absent: number = 9;
  }
  {
    var fromBlock: number = 4;
  }
  const shared: (() => number)[] = [];
  for (var index = 0, end = 3; index < end; index++) shared.push(() => index);
  const separate: (() => string)[] = [];
  const keys: string[] = [];
  for (const key in { "10": "ten", "2": "two", alpha: "a", "01": "one" }) {
    keys.push(key);
    separate.push(() => key);
  }
  var last: string = "";
  const sharedKeys: (() => string)[] = [];
  for (last in { first: true, second: true }) sharedKeys.push(() => last);
  let mixedKey: string | number = 7;
  const keyLengths: number[] = [];
  for (mixedKey in { alpha: true }) keyLengths.push(mixedKey.length);
  let untouchedKey: string | number = 7;
  for (untouchedKey in {}) {}
  var absentKey: string;
  for (var absentKey in {}) {}
  const sharedItems: (() => number)[] = [];
  for (var item of [7, 8]) sharedItems.push(() => item);
  var order: string = "";
  const result = (order += "a", order += "b", order.length);
  const discarded = void (order += "c");
  return {
    before,
    beforeValue: beforeValue === undefined,
    after: later,
    absent: typeof absent,
    fromBlock,
    parameter: varParameter(seed),
    uncheckedText: uncheckedText(seed, ["x"]),
    shared: shared.map(read => read()),
    separate: separate.map(read => read()),
    keys,
    last,
    sharedKeys: sharedKeys.map(read => read()),
    mixedKey,
    keyLengths,
    untouchedKey,
    absentKey: typeof absentKey,
    index,
    item,
    sharedItems: sharedItems.map(read => read()),
    order,
    result,
    discarded: typeof discarded,
    loose: [0 == "", 0 == false, [1] == 1, [] == false, [null] == "", {} == "[object Object]", undefined == null, NaN == NaN],
  };
}

const BUILD_TIME_VAR_SEMANTICS = varSemantics(5);

function defaultArgument(value: string = "fallback") {
  return { value, argument: typeof arguments[0], length: arguments.length };
}

function argumentSemantics(first: string, ...tail: string[]) {
  const read = () => arguments[0];
  const initial = { array: Array.isArray(arguments), string: String(arguments) };
  arguments[0] = "changed";
  arguments[3] = "extra";
  arguments.length = 1;
  const keys = Object.keys(arguments);
  function inner() { return arguments.length; }
  return { initial, first, tail, read: read(), keys, length: arguments.length, values: Array.from(arguments), inner: inner(), default: defaultArgument(undefined), callbackRest: ["first"].map((...args) => args.length), emptyCallbackRest: ["first"].map((value, index, array, ...args) => args.length) };
}

const BUILD_TIME_ARGUMENT_SEMANTICS = argumentSemantics("original", "tail");

function argumentSerialization(...values: string[]) {
  return JSON.stringify(arguments);
}
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

// Finite type algebra must preserve literal boundaries and optional reads in emitted PHP.
interface LanguageIdentity { id: number }
interface LanguageContent<S extends string = "draft"> { state: S; note?: string | null | undefined }
interface LanguageEntry<S extends string = "draft"> extends LanguageIdentity, LanguageContent<S> { title: string }
type LanguageProjection<T, K extends keyof T = keyof T> = { [P in K]: T[P] };
type LanguageFlags<K extends string> = { [P in K]: boolean };
type LanguageCopy<T> = { [K in keyof T]: T[K] };
type LanguageRequired<T> = { [K in keyof T]-?: T[K] };
type LanguageTag<T> = T extends string ? { kind: T } : { count: T };
type LanguageLiteral<T> = T extends "draft" ? "literal" : "broad";
type LanguageAbsent<T> = T extends undefined ? "undefined" : T extends null ? "null" : "present";
type Readonly<T> = { box: T }; // A local type shadows the global utility.
type LanguageBoth = LanguageIdentity & { extra: "x" };
type LanguageConstrained<T extends { id: number }> = { item: T };
type LanguageBool<T> = T extends true ? "yes" : "no";
type LanguageTogether<T> = [T] extends [string] ? "text" : "mixed";
function languageRead(item: LanguageEntry, key: keyof LanguageProjection<LanguageEntry, "state" | "title">): string {
  return item[key];
}

type LanguageBox<T> = { value: T };
class LanguageView {
  missing: undefined = undefined;
  entry: LanguageCopy<LanguageEntry> = { id: 0, state: "draft", title: "" };
  constructorArguments: number = 0;
  constructorFirst: string = "";
  constructor(entry: LanguageCopy<LanguageEntry>) {
    this.entry = entry;
    const count = () => arguments.length;
    this.constructorArguments = count();
    this.constructorFirst = typeof arguments[0];
  }
  snapshot(): Required<Pick<LanguageEntry, "id" | "note">> {
    return { id: this.entry.id, note: this.entry.note ?? null };
  }
  argumentSnapshot(value: string = "default") {
    const count = () => arguments.length;
    return { count: count(), first: typeof arguments[0], value };
  }
  clear(): void {
    const empty: undefined = undefined;
    this.missing = empty;
  }
}
class LanguageDraftView extends LanguageView {
  label: Exclude<"draft" | "published", "published"> = "draft";
  derivedArguments: number = 0;
  constructor(entry: LanguageCopy<LanguageEntry>, label: Exclude<"draft" | "published", "published">) {
    super(entry);
    this.label = label;
    const count = () => arguments.length;
    this.derivedArguments = count();
  }
}

const run = (handler: () => unknown) => action({ input: {}, handler });
// Feature detection on globalThis is resolved at compile time in both phases.
const GLOBAL_DETECTION = [typeof globalThis, typeof globalThis.Symbol, typeof globalThis.Math, typeof globalThis.window, typeof globalThis.location, globalThis.Deno === undefined];

// Build-time namespaces: objects holding functions, and functions with own properties,
// are resolved member by member at compile time; they never exist in PHP.
const local = { twice: (n: number) => n * 2, deep: { label: (s: string) => `<${s}>`, size: 4 }, list: ["a", "b"] };
function tagged(s: string) { return `#${s}`; }
tagged.prefix = "p";
tagged.upper = (s: string) => s.toUpperCase();
Object.assign(tagged, { count: 2, nested: { flag: true } });


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
  refsDateArrayCoercion: run(() => [
    new Date(["2020-01-01"]).getTime(),
    new Date([["2020-01-01"]]).getTime(),
  ]),
  refsContainerCoercion: run(() => {
    const nested = [1, null, [2, null], { x: 3 }];
    const empty: number[] = [];
    const object = { x: 1 };
    const parsedArray = JSON.parse('[7]');
    const parsedObject = JSON.parse('{}');
    return [String(nested), `${nested}`, "v=" + nested, nested + "!", String(object), `${object}`, "v=" + object,
      Number(empty), Number([null]), Number([[7]]), isNaN(Number([1, 2])), isNaN(Number(object)),
      String([2]) < String([10]), Number([2]) < Number([10]),
      Array.isArray(empty), Array.isArray(object), Array.isArray(parsedArray), Array.isArray(parsedObject),
      JSON.stringify({ empty, nested, object }), JSON.stringify({ parsedArray, parsedObject })];
  }),
  refsMissingReceiverWrite: run(() => {
    const a: { x: number }[] = []; let n = 0;
    try { a[2]!.x = ++n; } catch { return n; }
    return -1;
  }),
  refsMissingReceiverCompound: run(() => {
    const a: { x: number }[] = []; let n = 0;
    try { a[0]!.x += ++n; } catch { return n; }
    return -1;
  }),
  refsMissingReceiverLogical: run(() => {
    const a: { x: boolean }[] = [];
    try { a[0]!.x &&= true; return false; } catch { return true; }
  }),
  refsMissingNestedReceiver: run(() => {
    const a: { child: { x: number } }[] = []; let n = 0;
    try { a[0]!.child.x = ++n; } catch { return n; }
    return -1;
  }),
  refsMissingReceiverUpdate: run(() => {
    const a: { x: number }[] = [];
    try { return a[0]!.x++; } catch { return "caught"; }
  }),
  refsMissingElementCompound: run(() => {
    const numbers: number[] = []; numbers[0] += 1; numbers[1] -= 1;
    const strings: string[] = []; strings[0] += "x";
    const props: Record<string, number> = {}; props.x += 1; props.y++;
    const nulls: (number | null)[] = [null]; nulls[0]!++;
    return [numbers.map(n => isNaN(n)), strings, isNaN(props.x!), isNaN(props.y!), nulls];
  }),
  refsMissingPresenceSnapshot: run(() => {
    const a: number[] = [];
    const rhs = () => { a.push(10); return 1; };
    a[0] += rhs();
    return isNaN(a[0]!);
  }),
  refsUnusedJsonGap: run(() => [JSON.stringify({}, null, "123456789🙂"), JSON.stringify([], null, "123456789🙂")]),
  refsIndexStringCompound: run(() => { const a = ['a', 'b', 'c']; a[2] += 'x'; return a; }),
  refsIndexIncrement: run(() => { const a = [0, 1, 2, 3, 4, 5]; a[5]++; return a; }),
  refsIndexLogical: run(() => {
    const values: (boolean | null)[] = [true, false, null];
    let calls = 0;
    const rhs = () => { calls++; return true; };
    values[0] &&= rhs(); values[1] ||= rhs(); values[2] ??= rhs();
    values[0] ||= rhs(); values[1] ??= rhs();
    const empty: true[] = [];
    const skipped = (empty[0] &&= true);
    return [values, calls, skipped === true, empty.length];
  }),
  refsIndexAppend: run(() => { const a: number[] = []; a[0] = 5; a[a.length] = 6; a[0]!--; return a; }),
  refsIndexNullishAppend: run(() => { const a: (number | null)[] = [null]; a[0] ??= 5; a[1] ??= 6; return a; }),
  refsIndexMemberWrite: run(() => { const a = [{ x: 0 }, { x: 0 }, { x: 0 }]; a[2]!.x = 1; return a; }),
  refsObjectLoopBinding: run(() => { const fns: (() => number)[] = []; for (let s = { x: 0 }; s.x < 3; s.x++) fns.push(() => s.x); return fns.map(f => f()); }),
  refsReplacedLoopBinding: run(() => {
    const objectReaders: (() => number)[] = [];
    for (let s = { x: 0 }; s.x < 3; s = { x: s.x + 1 }) {
      objectReaders.push(() => s.x);
      if (s.x === 1) continue;
    }
    const arrayReaders: (() => number)[] = [];
    for (let s = [0]; s[0]! < 3; s = [s[0]! + 1]) arrayReaders.push(() => s[0]!);
    return [objectReaders.map(f => f()), arrayReaders.map(f => f())];
  }),
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
  refs30: run(() => { const identity = (p: { x: number }) => p; const forward = (p: { x: number }) => identity(p); const o = { x: 0 }; const r = forward(o); o.x = 1; return r.x === 1; }),
  refs31: run(() => { const reader = (p: { x: number }) => () => p.x; const o = { x: 0 }; const r = reader(o); o.x = 1; return r() === 1; }),
  refs32: run(() => { const a = [{ x: 0 }]; const r = a.map((e) => { a[0]!.x = 1; return e.x; }); return r[0] === 1; }),
  refs33: run(() => { const a = [{ x: 0 }]; const b = a.map((e) => ({ e })); b[0]!.e.x = 1; return a[0]!.x === 1; }),
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
  collections: { docs }, tables: { n, field_docs: fieldDocs() },
  actions: {
    nativeObjectParameters: run(() => [
      nativeParameter({ n: 1, label: null }),
      nativeParameter({ n: 2, label: "kept", optional: "present" }),
      nativeMissing(JSON.parse("{}") as { n: number }),
      nativeMissing({ n: 9007199254740991 }),
      reboundParameter({ n: 1 }),
      nullableParameter(null), nullableParameter({ n: 3 }),
    ]),
    ...laneRefs,
    namespaceImport: run(() => {
      const record = { count: 1 };
      return [ns.shout("hi"), ns.touch(record), record.count, ns.utils.isObject({}), ns.utils.isObject([]), ns.utils.join("a", "b"),
        ns.constants.SEP, ns.constants.limits.depth, ns.constants.REGEX_DOTS.source];
    }),
    namespaceLocal: run(() => [local.twice(3), local.deep.label("x"), local.deep.size + 1, local.list.length, local.list[1]]),
    namespaceDefault: run(() => [picoish.count, picoish.utils.join("x", "y"), picoish.matcher("*.md")("*.md"), picoish.matcher("b", { prefix: "a" })("ab")]),
    functionProperties: run(() => [tagged("x"), tagged.prefix, tagged.upper("y"), tagged.count, tagged.nested.flag]),
    functionAssign: run(() => [picoish.matcher.version, picoish.matcher.test("a", "a"), picoish.matcher.test("a", "b").isMatch,
      picoish.matcher.makeRe("a.b").source, picoish.matcher.makeRe("a..b").test("a.b"), picoish.matcher.scan("src/*.ts"), picoish.matcher.constants.SEP]),
    globalDetection: run(() => ({
      buildTime: GLOBAL_DETECTION,
      runtime: [typeof globalThis, typeof globalThis.Symbol, typeof globalThis.WeakMap, typeof globalThis.JSON, typeof globalThis.window, typeof globalThis.Bun, typeof globalThis.Deno, typeof globalThis.document, globalThis.window === undefined, globalThis.Bun !== undefined, typeof Symbol, typeof WeakSet],
    })),
    varSemantics: run(() => ({ buildTime: BUILD_TIME_VAR_SEMANTICS, runtime: varSemantics(5) })),
    argumentSemantics: run(() => ({ buildTime: BUILD_TIME_ARGUMENT_SEMANTICS, runtime: argumentSemantics("original", "tail") })),
    argumentSerialization: run(() => argumentSerialization("original", "tail")),
    languageTypes: run(() => {
      const candidates: Candidate[] = [{ kind: "other" }, { kind: "named", label: "found" }];
      const guard = isNamed;
      const guardedLabels: string[] = candidates.filter(guard).map(item => item.label);
      const predicateMap: boolean[] = candidates.map(isNamed);
      const guardedFind: string = candidates.findLast(isNamed)?.label ?? "";
      const guardedBranch: string = guardedLabel(candidates[1]);
      const booleanFilter = ["", "0", "value"].filter(Boolean);
      const networks: ReadonlyArray<["left" | "right", string]> = [["left", "Left"], ["right", "Right"]];
      const dictionary = { left: "L", right: "R" };
      const tupleLabels = networks.flatMap(([key, label]) => [`${label}:${dictionary[key]}`]);
      const arrayPresence: { tags?: string[] } & { tags: string[] } = { tags: ["present"] };
      const scalarTypes = [7, "Hello", true, false, null].map(scalarLabel);
      const scalarFalseBranches = [7, "Hello", null].map(scalarRemainder);
      const item: LanguageCopy<LanguageEntry> = { id: 7, state: "draft", title: "Hello" };
      const optional: Partial<Omit<LanguageEntry, "id">> = {};
      const projectedOptional: LanguageProjection<LanguageEntry, "note"> = {};
      const boxedView: LanguageBox<LanguageDraftView> = { value: new LanguageDraftView(item, "draft") };
      boxedView.value.clear();
      const required: Required<Pick<LanguageEntry, "id" | "note">> = boxedView.value.snapshot();
      const mapped: LanguageRequired<LanguageProjection<LanguageEntry, "id" | "note">> = { id: item.id, note: "set" };
      const flags: Record<"ready" | "visible", boolean> = { ready: true, visible: false };
      const changed: LanguageFlags<"ready" | "visible"> = flags;
      const key: keyof ({ common: number; left: string } | { common: string; right: boolean }) = "common";
      const state: Exclude<Extract<"draft" | "published" | 7, string>, "published"> = item.state;
      const value: LanguageEntry["id" | "state"] = item.id;
      const element: Array<string>[number] = "element";
      const pair: ["draft", number][0 | 1] = 8;
      const tags: LanguageTag<"draft" | 7> = { count: 7 };
      const together: LanguageTogether<"draft" | 7> = "mixed";
      const args: Parameters<(n: number, s: string) => boolean> = [1, "one"];
      const returned: ReturnType<(n: number) => "ok" | null> = null;
      const awaited: Awaited<Promise<Promise<"done">>> = "done";
      const bools: LanguageBool<boolean | "other">[] = ["yes", "no"];
      const undefinedType: LanguageAbsent<undefined> = "undefined";
      const nullType: LanguageAbsent<null> = "null";
      const weak: { x: number } extends { y?: string } ? "yes" : "no" = "no";
      const intersection: { note?: string } & { note: string | undefined } = { note: undefined };
      const optionalConflict: { note?: string } & { note?: number } = {};
      const directLabels: { [P in keyof { note?: number }]: string } = { note: undefined };
      const optionalSnapshot: { note?: string } = { note: undefined };
      const requiredUndefined: Required<{ label?: string | undefined }> = { label: "present" };
      const both: LanguageBoth = { id: 9, extra: "x" };
      const boxed: LanguageConstrained<{ id: number; title: string }> = { item: { id: 9, title: "extra" } };
      const collapsed: LanguageLiteral<string | "draft"> = "broad";
      const onlyFalse: Exclude<boolean, true> = false;
      const shadowed: Readonly<number> = { box: 7 };
      return { scalarTypes, scalarFalseBranches, guardedLabels, predicateMap, guardedFind, guardedBranch, booleanFilter, tupleLabels, arrayPresence,
        classMissing: boxedView.value.missing ?? null, classState: boxedView.value.label,
        classInstance: boxedView.value instanceof LanguageView, classType: typeof LanguageDraftView,
        classArguments: { base: boxedView.value.constructorArguments, first: boxedView.value.constructorFirst,
          derived: boxedView.value.derivedArguments, omitted: boxedView.value.argumentSnapshot(), supplied: boxedView.value.argumentSnapshot("passed") },
        required, mapped, changed, key, state, value, element, pair, tags, together, args, returned, awaited, bools, onlyFalse, undefinedType, nullType, weak, requiredUndefined, optionalConflict, directLabels: { note: directLabels.note ?? null }, optionalSnapshot: { note: optionalSnapshot.note ?? null }, intersection: { note: intersection.note ?? null }, both, boxed, shadowed, collapsed,
        missing: projectedOptional.note ?? optional.note ?? null, title: languageRead(item, "title"), inherited: languageRead(item, "state") };
    }),
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
    numbers: run(() => {
      const finite = Number.isFinite;
      return {
        arithmetic: [0.1 + 0.2, 7 / 2, -7 % 3, 2 ** 10, 1 / 3, Math.max(1, 5, 3), Math.floor(-1.5), Math.round(2.5), Math.round(-2.5)],
        finite: FINITE_VALUES.map(value => [finite(value), isFinite(value)]),
        finiteIdentity: finite === Number.isFinite,
        finiteCaptured: NUMBER_IS_FINITE(3),
        finiteNoArgs: [finite(), Number.isFinite(), isFinite()],
        pureFinite: PURE_FINITE,
      };
    }),
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
        pre, a, k, 2 ** 60 + 1, p, Math.pow(2, 60) - 1, 2 ** 0.5, 2 ** -2, parsed - 1];
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
      "left|right".replaceAll("|", "\n"),
      "\r\n  $literal ${value} \"quote\" \\path\n",
      "aba".replaceAll("a", replacementOffset),
      "ab".replace(/b/, (match: string, offset: number, source: string) => `${match}:${offset}:${source}`),
      "ab".replace(/(a)?b/, (_match, capture: string | undefined, offset: number) => `${capture ?? "missing"}:${offset}`),
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
    ...stdlibActions(),
  },
  jobs: laneDJobs(),
});

// ---- lane D: jobs, once(), process.env (phase 2 §6.1). The Node shim keeps once() receipts and pending
// enqueue keys in memory; PHP keeps them in __first_receipts and the outbox. Keys are unique per case.
function laneDJobs() {
  return { ping: job({ input: { note: text().optional() }, handler: async () => {} }) };
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
    envRead: action({ input: {}, handler: () => [process.env.FIRST_LANE_D_UNSET ?? "unset", typeof process.env["PATH"], process.env.FIRST_LANE_D_UNSET === undefined] }),
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

// ---- standard objects: Map and Set in typed code (docs/decisions/2026-11-07-stdlib-objects.md).
type Entry = { n: number };
// Module-level collections are built once at configuration time and captured as one runtime handle.
const NOT_FOUND = new Set([404, 410]);
const OPS = new Map<string, "read" | "write">([["get", "read"], ["put", "write"]]);
function stdlibActions() {
  return {
    mapOrder: run(() => {
      const m = new Map<string, Entry>();
      m.set("b", { n: 1 }).set("a", { n: 2 }).set("b", { n: 4 });
      const seen: string[] = [];
      // Entries added during iteration are visited; deleted ones are skipped.
      for (const [key, v] of m) {
        seen.push(`${key}=${v.n}`);
        if (key === "b") { m.set("c", { n: 3 }); m.delete("a"); }
      }
      m.forEach((v, key, self) => { seen.push(`${key}${v.n}${self.size}`); });
      return [seen, [...m.keys()], m.size, m.get("c")?.n ?? -1, m.get("z") === undefined, m.delete("z"), m.delete("c"), m.size];
    }),
    mapKeys: run(() => {
      const k = { n: 9 };
      const byObj = new Map<Entry, string>([[k, "obj"]]);
      const nums = new Map<number, string>([[NaN, "nan"], [0, "first"], [-0, "negzero"]]);
      const mixed = new Map<string | number | null, number>([["1", 1], [1, 2], [null, 3]]);
      return [byObj.get(k) ?? "none", byObj.has({ n: 9 }), nums.get(NaN) ?? "", nums.get(-0) ?? "", nums.size, 1 / ([...nums.keys()][1] ?? 1), mixed.get("1"), mixed.get(1), mixed.get(null), mixed.size];
    }),
    jsCollections: run(() => jsCollections()),
    jsAbort: run(() => jsAbort()),
    jsTimers: run(() => jsTimers()),
    typedAbort: run(() => {
      const order: string[] = [];
      const c = new AbortController();
      const signal: AbortSignal = c.signal;
      const once = () => { order.push("once"); };
      const kept = () => { order.push("kept"); };
      const removed = () => { order.push("removed"); };
      signal.addEventListener("abort", once, { once: true });
      signal.addEventListener("abort", kept);
      signal.addEventListener("abort", kept);
      signal.addEventListener("abort", removed);
      signal.removeEventListener("abort", removed);
      const before = signal.aborted;
      c.abort(new Error("stop"));
      c.abort(new Error("again"));
      let thrown = "none";
      try { signal.throwIfAborted(); } catch (e) { thrown = e.message; }
      const timer = setTimeout(() => { order.push("never"); }, 10);
      clearTimeout(timer);
      // Static constructors from typed code, and nested AbortSignal.any folding.
      const root = new AbortController();
      const inner = AbortSignal.any([root.signal]);
      const outer = AbortSignal.any([inner, AbortSignal.timeout(1000)]);
      outer.addEventListener("abort", () => { order.push("outer"); });
      root.abort(new Error("root"));
      const pre = AbortSignal.abort(new Error("pre"));
      const parsed = URL.parse("https://example.com/a?b=1");
      return [before, signal.aborted, order, thrown, signal.reason === undefined, inner.aborted, outer.aborted, pre.aborted, parsed?.pathname ?? "none", URL.canParse("nope")];
    }),
    typedUrls: run(() => {
      const disposition = 'attachment; filename="a b.txt"';
      const query = `memory://k?${new URLSearchParams({ "response-content-disposition": disposition }).toString()}`;
      const u = new URL("../x?y=1#z", "https://Example.com/a/b");
      const params: URLSearchParams = u.searchParams;
      params.append("w", "1 2");
      const names: string[] = [];
      for (const [n, v] of params) names.push(n + v);
      params.forEach((v, n) => { names.push(`${n}:${v}`); });
      const pairs = new URLSearchParams([["a", "1"], ["b", "2"], ["a", "3"]]);
      pairs.delete("a", "1");
      // Component setters and static parsing from typed code; iteration sees mutations live.
      u.pathname = "/a b";
      u.port = "8443";
      u.hash = "";
      const live: string[] = [];
      const mutating = new URLSearchParams("a=1&b=2");
      mutating.forEach((v, n) => { live.push(n); if (n === "a") { mutating.delete("b"); mutating.append("c", "3"); } });
      const parsed = URL.parse("https://example.com/p?q=1");
      return [query, u.href, u.origin, u.host, u.pathname, params.get("y"), params.get("nope"), params.getAll("w"), params.has("y"), names, pairs.toString(), pairs.size, [...pairs.keys()], String(u), u.toJSON(), live, parsed?.search ?? "none", URL.parse("nope") === null, URL.canParse("/x", "http://h")];
    }),
    moduleCollections: run(() => [NOT_FOUND.has(404), NOT_FOUND.has(500), NOT_FOUND.size, OPS.get("put") ?? "none", [...OPS.keys()]]),
    setOps: run(() => {
      const s = new Set([3, 1, 3, 2]);
      const deleted = [s.delete(1), s.delete(1)];
      const visited: number[] = [];
      for (const v of s) { visited.push(v); if (v === 3) s.add(7); }
      const copy = new Set<number>(s);
      copy.clear();
      return [deleted, visited, [...s], [...s.entries()], Array.from(s.keys(), (v, i) => v * 10 + i), s.has(7), s.size, copy.size, new Set("abca").size];
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
  return table({
    ownerId: integer().optional(),
    salary: integer().access({
      read: (ctx) => ctx.user !== null && (RANK.indexOf(ctx.user.role) >= 2 || ctx.data.ownerId === ctx.user.id),
      update: (ctx) => ctx.user?.role === "admin" || (ctx.data.salary !== null && ctx.op === "update"),
    }).optional(),
  });
}
