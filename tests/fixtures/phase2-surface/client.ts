import type { Author, Post, WidenedOutput } from "./zero/client/types";

const sample: WidenedOutput = { values: ["other"], choice: "other", finite: ["a", "b"], nested: [["other", "later"]], callbacks: [null], tuples: ["other"], finiteDefaults: ["a", "b"], defaultTuple: "other", reduced: "other", reducedNested: ["other", "later"], numeric: { value: 2, count: 2, item: 2, keep: 0 }, effects: { captured: 2, invoked: 2, loop: 2, helper: { count: 3, captured: 3, keep: 0 }, maybeCaptured: null, maybeHelper: null, shadow: 1, early: 0, byValue: 1, passed: { scalar: null, member: null, object: { maybe: null, keep: 0 }, destructured: { maybe: null, keep: 0 } }, callback: 2, defaulted: 2, localDefaulted: 2, logical: { nullish: 2, or: 2, and: 1, guarded: 3, absent: 0, nested: 4 }, nullableArguments: { local: 1, module: 2, absent: null, sibling: 3, stable: "a", unchecked: { empty: null, shortened: null, tail: [null], reversed: "b", captured: "b", forwarded: "b", grown: "a", optional: null, present: true, defaulted: true, moduleDefaulted: true, moduleProvided: false, destructuredDefault: true, destructuredProvided: false, early: null, late: "b" }, ordered: 4, looped: "b", earlier: 0 } }, formatted: "-1", inferredNumber: "0", functionMaybe: null, defaultMaybe: null, maybe: null };
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

const numeric: { value: number; count: number; item: number | null; keep: 0 } = sample.numeric;
const formatted: string = sample.formatted;
const inferredNumber: string = sample.inferredNumber;

const effects: { captured: number; invoked: number; loop: number; helper: { count: number; captured: number; keep: 0 }; maybeCaptured: boolean | null; maybeHelper: boolean | null; shadow: 0 | 1; early: 0 | 1; byValue: 0 | 1; passed: { scalar: boolean | null; member: boolean | null; object: { maybe: boolean | null; keep: 0 }; destructured: { maybe: boolean | null; keep: 0 } }; callback: number; defaulted: number; localDefaulted: number; logical: { nullish: number; or: number; and: number; guarded: number; absent: number; nested: number | null }; nullableArguments: { local: number | null; module: number | null; absent: number | null; sibling: number; stable: "a" | "b"; unchecked: { empty: "a" | "b" | null; shortened: "a" | "b" | null; tail: (number | null)[]; reversed: "a" | "b" | null; captured: "a" | "b" | null; forwarded: "a" | "b" | null; grown: "a" | "b" | null; optional: boolean | null; present: boolean | null; defaulted: boolean; moduleDefaulted: boolean; moduleProvided: boolean; destructuredDefault: boolean; destructuredProvided: boolean; early: "a" | "b" | null; late: "a" | "b" | null }; ordered: number | null; looped: "a" | "b"; earlier: number } } = sample.effects;

// Field access (phase 2 §4.3): a column with a read rule other than "anyone" can be absent from a row.
const anonymousAuthor: Author = { id: 1, name: "A", status: "published", publishedAt: null, uid: null };
const email: string | null | undefined = anonymousAuthor.email;
// @ts-expect-error a possibly hidden column is not always present
const alwaysEmail: string | null = anonymousAuthor.email;
type Seo = NonNullable<Post["seo"]>;
const seo: Seo = { kind: "a", enabled: true };
void [email, alwaysEmail, seo];

// A possibly hidden media column stays optional when `with` populates it.
import type { RowWith } from "./zero/client/index.ts";
declare const withAvatar: RowWith<"authors", { avatar: true }>;
const avatar: import("./zero/client/types").Media | null | undefined = withAvatar.avatar;
// @ts-expect-error a populated hidden media column may be absent
const alwaysAvatar: import("./zero/client/types").Media | null = withAvatar.avatar;
void [avatar, alwaysAvatar];

