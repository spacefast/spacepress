// Every action here runs under Node and as compiled PHP; results must be identical.
// Add a case whenever the compiler learns a construct. Keep each one small.
import { collection, id, defineConfig, action } from "zero";

const n = collection("n", { id: id() });

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

const run = (handler: () => unknown) => action({ input: {}, handler });

export default defineConfig({
  schema: { n },
  actions: {
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
      return { names, inStock, total, sorted, byQty, some: ITEMS.some((i) => i.qty === 0), idx: ITEMS.findIndex((i) => i.name === "eggs") };
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
      const maybe: string | null = ITEMS[1].tags.length > 0 ? "x" : null;
      return [maybe ?? "none", maybe?.length ?? -1, ITEMS[0].tags[0] ?? "?", ITEMS[1].tags[0] ?? "?"];
    }),
    templates: run(() => ITEMS.map(label)),
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
