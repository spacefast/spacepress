import type { WidenedOutput } from "./zero/client/types";

const sample: WidenedOutput = { values: ["other"], choice: "other", finite: ["a", "b"], nested: [["other", "later"]], callbacks: [null], tuples: ["other"], finiteDefaults: ["a", "b"], defaultTuple: "other", reduced: "other", reducedNested: ["other", "later"], numeric: { value: 2, count: 2, item: 2, keep: 0 }, formatted: "-1", inferredNumber: "0", functionMaybe: null, defaultMaybe: null, maybe: null };
const values: string[] = sample.values;
const choice: string = sample.choice;
const finite: ("a" | "b")[] = sample.finite;
const nested: string[][] = sample.nested;
const callbacks: (boolean | null)[] = sample.callbacks;
const tuples: string[] = sample.tuples;
const finiteDefaults: ("a" | "b")[] = sample.finiteDefaults;
const defaultTuple: string = sample.defaultTuple;
const reduced: string = sample.reduced;
const reducedNested: string[] = sample.reducedNested;
const functionMaybe: boolean | null = sample.functionMaybe;
const defaultMaybe: boolean | null = sample.defaultMaybe;
const maybe: boolean | null = sample.maybe;

const numeric: { value: number; count: number; item: number; keep: 0 } = sample.numeric;
const formatted: string = sample.formatted;
const inferredNumber: string = sample.inferredNumber;
