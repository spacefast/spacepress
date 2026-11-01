// Every action, access rule, and `.validate` closure here runs under Node and as compiled PHP;
// results must be identical. Add a case whenever the compiler learns a construct. Keep each one small.
import { collection, id, text, integer, defineConfig, action } from "zero";
import { job, jobs, once, env } from "zero"; // lane D

const n = collection("n", { id: id() }, { editor: false });

// Access rules run once per ctx below; validators once per value (with VALIDATE_CTX).
export const ACCESS_CTXS = [
  { user: null, target: "standalone" },
  { user: { id: 7, name: "Sub", role: "subscriber" }, target: "wp" },
  { user: { id: 3, name: "Ed", role: "editor" }, target: "standalone", data: { title: "Hi", ownerId: 3 } },
  { user: { id: 9, name: "Al", role: "author" }, target: "standalone", data: { title: "", ownerId: 9 } },
  { user: { id: 1, name: "Root", role: "admin" }, target: "standalone", data: { title: "Mine", ownerId: 1 } },
];
export const VALIDATE_VALUES = {
  "docs.title": ["Hello", "http://spam", "  ", "Ärtsoppa är god"],
  "docs.score": [0, 7, 11, 2.5],
};
export const VALIDATE_CTX = { data: { title: "x", score: 1 }, user: { id: 1, name: "A", role: "admin" }, target: "wp" };

const RANK = ["subscriber", "author", "editor", "admin"];

export const docs = collection("docs", {
  id: id(),
  title: text().notNull().validate((v): true | string => v.includes("http://") ? "No links" : v.trim().length > 0 || "blank"),
  score: integer().validate((v, ctx) => (v % 2 === 1 && ctx.user?.role === "admin" ? `odd ${v} for ${ctx.target}` : undefined)),
  ownerId: integer(),
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
    delete: (ctx) => ctx.target === "wp" ? false : ctx.user?.role === "admin",
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

export default defineConfig({
  schema: { n, docs, fieldDocs: fieldDocs() },
  actions: {
    hookCtx: action({ input: {}, handler: (_input, ctx) => [ctx.user?.name ?? "anonymous", ctx.target] }),
    numbers: run(() => [0.1 + 0.2, 7 / 2, -7 % 3, 2 ** 10, 1 / 3, Math.max(1, 5, 3), Math.floor(-1.5), Math.round(2.5), Math.round(-2.5)]),
    // JS numbers are doubles: integer arithmetic past ±2^53 rounds, where PHP ints would stay exact.
    bigIntegers: run(() => {
      let i = 2 ** 53 - 1;
      const before = i++;
      const after = ++i;
      let j = -(2 ** 53) + 1;
      j -= 2;
      // Prefix/postfix on an index with a side effect evaluate the place once.
      const a = [10, 20];
      let k = 0;
      const pre = ++a[k++]!;
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
    // In-place updates of existing elements and of fields reached through them; every index with a
    // side effect is evaluated once, outer ones included.
    elementUpdates: run(() => {
      const a: number[] = [1, 2, 3];
      let i = 0;
      a[i++]! += 5;
      const step = a[2]!++;
      --a[1]!;
      a[i++] &&= 9;
      const s: string[] = ["a"];
      s[0] += "x";
      const m: number[][] = [[1], [2]];
      const ix: number[] = [0, 1];
      m[ix.pop()!]![0]!++;
      m[0]![0]! *= 10;
      const objs: { x: number }[] = [{ x: 1 }];
      objs[0]!.x = 5;
      objs[0]!.x += 2;
      return [a, i, step, s, m, ix, objs];
    }),
    // String lastIndexOf reads an undefined position as omitted and null as 0; the rest read both
    // as 0.
    nullishPositions: run(() => ["ab".lastIndexOf("b", undefined), "ab".lastIndexOf("b", null as unknown as number), [1, 2].lastIndexOf(2, undefined), [1, 2].includes(1, null as unknown as number), "ab".at(undefined as unknown as number), [1, 2].at(null as unknown as number), "ab".indexOf("b", undefined)]),
    arrayFromIndex: run(() => [[1, 2].includes(1, 1), [1, 2].includes(2, -1), [1, 2, 1].lastIndexOf(1, 1), [1, 2, 1].lastIndexOf(1, -2), [1, 2].includes(1, 5), [1].lastIndexOf(1, -1e300), [1].lastIndexOf(1, -1e20), [1, 2].includes(1, -1e300), [1, 2, 1].lastIndexOf(1, 1e300)]),
    utf16Units: run(() => {
      const s = "\u{1F600}a\u00e9";
      return [s.length, s.indexOf("a"), s.lastIndexOf("\u00e9"), s.slice(2), s.substring(0, 2), s.charAt(2), s.at(-1), s.padStart(6, "-"), s.padEnd(5, "."), s.replace("a", (m, at: number) => `${m}@${at}`)];
    }),
  };
}

// ---- lane B: field access (phase 2 §4). A field rule compiles through the access-fn path; data is
// the row on read, the incoming data on create/update, the enclosing item for sub-fields.
export const FIELD_CTXS = [
  { user: null, target: "standalone", data: { ownerId: 1, salary: 10 } },
  { user: { id: 1, name: "Owner", role: "author" }, target: "wp", data: { ownerId: 1, salary: 10 } },
  { user: { id: 2, name: "Other", role: "author" }, target: "standalone", data: { ownerId: 1, salary: null } },
  { user: { id: 3, name: "Ed", role: "editor" }, target: "standalone", data: { ownerId: 1, salary: 5 } },
];

// A hoisted function, so the collection can live in this block below the default export.
function fieldDocs() {
  return collection("fieldDocs", {
    id: id(),
    ownerId: integer(),
    salary: integer().access({
      read: (ctx) => ctx.user !== null && (RANK.indexOf(ctx.user.role) >= 2 || ctx.data.ownerId === ctx.user.id),
      update: (ctx) => ctx.target === "wp" ? ctx.user?.role === "admin" : ctx.data.salary !== null && ctx.op === "update",
    }),
  }, { editor: false });
}

