// Every action, access rule, and `.validate` closure here runs under Node and as compiled PHP;
// results must be identical. Add a case whenever the compiler learns a construct. Keep each one small.
import { collection, id, text, integer, defineConfig, action } from "zero";

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

const run = (handler: () => unknown) => action({ input: {}, handler });

export default defineConfig({
  schema: { n, docs },
  actions: {
    hookCtx: action({ input: {}, handler: (_input, ctx) => [ctx.user?.name ?? "anonymous", ctx.target] }),
    numbers: run(() => [0.1 + 0.2, 7 / 2, -7 % 3, 2 ** 10, 1 / 3, Math.max(1, 5, 3), Math.floor(-1.5), Math.round(2.5), Math.round(-2.5)]),
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
      return { names, inStock, total, sorted, byQty, words, nested, choice, callback, callbackDefaults, iteration, defaults, value, flag, flags, chosen: choose(), label: label(), predicates: predicates.map(predicate => predicate()), reduced, reducedNested, readers: readers.map(read => read()), defaultCount, missing: missing === undefined, suppliedCount, supplied: supplied.count, some: ITEMS.some((i) => i.qty === 0), idx: ITEMS.findIndex((i) => i.name === "eggs") };
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
  },
});
