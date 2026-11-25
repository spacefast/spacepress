import type { Author, Post, WidenedOutput } from "./sp/_generated/client/types";

const sample: WidenedOutput = { values: ["other"], choice: "other", finite: ["a", "b"], nested: [["other", "later"]], callbacks: [null], tuples: ["other"], finiteDefaults: ["a", "b"], defaultTuple: "other", reduced: "other", reducedNested: ["other", "later"], numeric: { value: 2, count: 2, item: 1, keep: 0 }, effects: { captured: 2, invoked: 2, loop: 2, helper: { count: 3, captured: 3, keep: 0 }, maybeCaptured: undefined, maybeHelper: undefined, shadow: 1, early: 0, byValue: 1, passed: { scalar: undefined, member: undefined, object: { maybe: undefined, keep: 0 }, destructured: { maybe: undefined, keep: 0 } }, callback: 2, defaulted: 2, localDefaulted: 2, logical: { nullish: 2, or: 2, and: 1, guarded: 3, absent: 0, nested: 4 }, nullableArguments: { local: 1, module: 2, absent: undefined, sibling: 3, stable: "a", unchecked: { empty: undefined, shortened: undefined, tail: [null], reversed: "b", captured: "b", forwarded: "b", grown: "a", optional: undefined, present: true, defaulted: true, moduleDefaulted: true, moduleProvided: false, destructuredDefault: true, destructuredProvided: false, early: null, late: "b" }, ordered: 4, looped: "b", earlier: 0 } }, formatted: "-1", inferredNumber: "0", functionMaybe: undefined, defaultMaybe: undefined, maybe: undefined };
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
const functionMaybe: boolean | undefined = sample.functionMaybe;
const defaultMaybe: boolean | undefined = sample.defaultMaybe;
const maybe: boolean | undefined = sample.maybe;

const numeric: { value: number; count: number; item?: number; keep: 0 } = sample.numeric;
const formatted: string = sample.formatted;
const inferredNumber: string = sample.inferredNumber;

const effects: { captured: number; invoked: number; loop: number; helper: { count: number; captured: number; keep: 0 }; maybeCaptured?: boolean; maybeHelper?: boolean; shadow: 0 | 1; early: 0 | 1; byValue: 0 | 1; passed: { scalar?: boolean; member?: boolean; object: { maybe?: boolean; keep: 0 }; destructured: { maybe?: boolean; keep: 0 } }; callback: number; defaulted: number; localDefaulted: number; logical: { nullish: number; or: number; and: number; guarded: number; absent: number; nested?: number }; nullableArguments: { local?: number; module?: number; absent?: number; sibling: number; stable: "a" | "b"; unchecked: { empty?: "a" | "b"; shortened?: "a" | "b"; tail: (number | null)[]; reversed?: "a" | "b"; captured?: "a" | "b"; forwarded?: "a" | "b"; grown?: "a" | "b"; optional?: boolean; present?: boolean; defaulted: boolean; moduleDefaulted: boolean; moduleProvided: boolean; destructuredDefault: boolean; destructuredProvided: boolean; early: "a" | "b" | null; late: "a" | "b" | null }; ordered?: number; looped: "a" | "b"; earlier: number } } = sample.effects;

// Field access (phase 2 §4.3): a column with a read rule other than "anyone" can be absent from a row.
const anonymousAuthor: Author = {
  id: 1,
  name: "A",
  status: "published",
  publishedAt: null,
  uid: null,
  author: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  deletedBy: null,
};
const email: string | null | undefined = anonymousAuthor.email;
// @ts-expect-error a possibly hidden column is not always present
const alwaysEmail: string | null = anonymousAuthor.email;
type Seo = NonNullable<Post["seo"]>;
const seo: Seo = { kind: "a", enabled: true };
void [email, alwaysEmail, seo];

// A possibly hidden media column stays optional when `with` populates it.
import type { RowWith } from "./sp/_generated/client/index.ts";
declare const withAvatar: RowWith<"authors", { avatar: true }>;
const avatar: import("./sp/_generated/client/types").Media | null | undefined = withAvatar.avatar;
// @ts-expect-error a populated hidden media column may be absent
const alwaysAvatar: import("./sp/_generated/client/types").Media | null = withAvatar.avatar;
void [avatar, alwaysAvatar];

// §7.3: the generated client types localized collections (posts) and keeps others (audit) plain.
import type { Locale as ClientLocale, PostInsert, PostPatch, PostFilter } from "./sp/_generated/client/types";
const locales: ClientLocale[] = ["en", "de"];
// @ts-expect-error a locale outside the config
const badLocale: ClientLocale = "fr";
declare const post: Post;
const translations: Partial<Record<"en" | "de", number>> = post.translations;
const postLocale: "en" | "de" = post.locale;
// @ts-expect-error the group id is hidden
post.translationGroup;
const translation: PostInsert = { title: "Hallo", locale: "de", translationOf: 1, slug: null };
// A translation copies synced columns, so they may be omitted; a fresh row needs its required ones.
type Required<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];
type FreshRequired = Required<Extract<PostInsert, { translationOf?: undefined }>>;
const freshNeedsTitle: "title" extends FreshRequired ? true : false = true;
// @ts-expect-error translations are derived
const derived: PostInsert = { title: "x", translations: {} };
// @ts-expect-error locale is fixed per row
const moved: PostPatch = { locale: "de" };
// @ts-expect-error translations can't be filtered
const byGroup: PostFilter = { translations: null };
void [locales, badLocale, translations, postLocale, translation, freshNeedsTitle, derived, moved, byGroup];
