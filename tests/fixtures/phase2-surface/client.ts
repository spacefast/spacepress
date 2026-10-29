import type { WidenedOutput } from "./zero/client/types";

const sample: WidenedOutput = { values: ["other"], choice: "other", finite: ["a", "b"], nested: [["other", "later"]], callbacks: [null], tuples: ["other"], finiteDefaults: ["a", "b"], defaultTuple: "other", reduced: "other", reducedNested: ["other", "later"], numeric: { value: 2, count: 2, item: 2, keep: 0 }, effects: { captured: 2, invoked: 2, loop: 2, helper: { count: 3, captured: 3, keep: 0 }, maybeCaptured: null, maybeHelper: null, shadow: 1, early: 0, byValue: 1, passed: { scalar: null, member: null, object: { maybe: null, keep: 0 } }, callback: 2 }, formatted: "-1", inferredNumber: "0", functionMaybe: null, defaultMaybe: null, maybe: null };
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

const effects: { captured: number; invoked: number; loop: number; helper: { count: number; captured: number; keep: 0 }; maybeCaptured: boolean | null; maybeHelper: boolean | null; shadow: 0 | 1; early: 0 | 1; byValue: 0 | 1; passed: { scalar: boolean | null; member: boolean | null; object: { maybe: boolean | null; keep: 0 } }; callback: number } = sample.effects;
