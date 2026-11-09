import { collection, id, text, email, media, integer, boolean, richText, slug, group, repeater, blocks, json, select, file, files, job, env, global, action, defineConfig, db, table, userProjection } from "first";
import type { FieldAccessCtx as FieldContext, JobCtx } from "first";
function deny(): never { throw new Error("denied"); }
async function yes() { return true; }
async function no() { return false; }
const HIDE = "hide";
const SHOW = "show";
const YES = true;
const NIL = null;
function templateResult(): "show" { return `show`; }
function updateNumeric(value: 0 | 1) { value++; if (value > 0) { value--; } value += 1; let record: { count: 0 | 1, values: (0 | 1)[], keep: 0 } = { count: 1, values: [1], keep: 0 }; if (value > 0) { record.count++; } return { value, count: record.count, item: record.values[0], keep: record.keep }; }
function captureNumeric(value: 0 | 1) { const read = () => value; value++; return read(); }
function invokeNumeric(value: 0 | 1) { const bump = () => { value++; }; bump(); return value; }
function loopNumeric(value: 0 | 1) { while (true) { if (value > 1) return value; value++; } }
function bumpNumeric(record: { count: 0 | 1, keep: 0 }) { record.count++; }
function forwardNumeric(record: { count: 0 | 1, keep: 0 }) { bumpNumeric(record); }
function helperNumeric() { forwardNumeric({ count: 1, keep: 0 }); const record: { count: 0 | 1, keep: 0 } = { count: 1, keep: 0 }; const read = () => record.count; forwardNumeric(record); const bump = (value: { count: 0 | 1, keep: 0 }) => { value.count++; }; bump(record); return { count: record.count, captured: read(), keep: record.keep }; }
function maybeCapture(value: 0 | 1) { const read = () => value; value++; switch (read()) { case 0: case 1: return true; } }
function maybeHelper() { let record: { count: 0 | 1, keep: 0 } = { count: 1, keep: 0 }; bumpNumeric(record); switch (record.count) { case 0: case 1: return true; } }
function finiteIdentity(value: 0 | 1): 0 | 1 { return value; }
function earlyNumeric(value: 0 | 1): 0 | 1 { if (value === 0) return finiteIdentity(value); value++; return 1; }
function byValueNumeric(value: 0 | 1): 0 | 1 { let write = () => {}; const unused = () => { write = () => { value++; }; }; const read = (): 0 | 1 => value; write(); captureNumeric(value); return read(); }
function shadowNumeric(value: 0 | 1) { const read = () => value; { let value: 0 | 1 = 1; value++; } return read(); }
function acceptNumeric(value: 0 | 1) { switch (value) { case 0: case 1: return true; } }
function acceptNumericMember(value: { count: 0 | 1, keep: 0 }) { return { maybe: acceptNumeric(value.count), keep: value.keep }; }
function acceptDestructured({ count, keep }: { count: 0 | 1, keep: 0 }) { return { maybe: acceptNumeric(count), keep }; }
function passedNumeric() { let value: 0 | 1 = 1; const bump = () => { value++; }; bump(); let record: { count: 0 | 1, keep: 0 } = { count: 1, keep: 0 }; bumpNumeric(record); return { scalar: acceptNumeric(value), member: acceptNumeric(record.count), object: acceptNumericMember(record), destructured: acceptDestructured(record) }; }
function callbackNumeric() { let value: 0 | 1 = 0; const writers = [() => { value++; }]; const flattened = writers.flatMap(write => [write]); const selected = flattened.reduce((acc, write) => write, () => {}); selected(); selected(); return value; }
function defaultNumeric(value: 0 | 1, write: (() => void) | null = () => { value++; }) { if (write !== null) write(); return value; }
function localDefaultNumeric(value: 0 | 1) { const run = (write: (() => void) | null = () => { value++; }) => { if (write !== null) write(); }; run(); return value; }
function guardedNumeric(record: { count: number } | null): number { if (record !== null) { record.count = 1; record.count += 1; record.count++; return record.count; } return 0; }
function logicalNumeric(value: 0 | 1) { value++; const nullish = (value ??= 1); const or = (value ||= 1); const and = (value &&= 1); const wrapper: { inner: { count: number } | null } = { inner: { count: 0 } }; if (wrapper.inner !== null) wrapper.inner.count = 4; return { nullish, or, and, guarded: guardedNumeric({ count: 0 }), absent: guardedNumeric(null), nested: wrapper.inner?.count }; }
function mutateNullable(value: { count: number } | null, extra: number[]) { if (value !== null) value.count++; }
function firstTuple(pair: ["a", "b"]) { return pair[0]; }
function defaultFlag({ flag }: { flag: boolean } = { flag: true }): boolean { return flag; }
function uncheckedReads() {
  const empty: ("a" | "b")[] = [];
  const pair: ["a", "b"] = ["a", "b"];
  pair.pop();
  const [, ...tail] = [0, null];
  const reversed: ["a", "b"] = ["a", "b"];
  const capture = () => reversed[0];
  reversed.reverse();
  const grown: ["a", "b"] = ["a", "b"];
  grown.push("a");
  const read = (flag?: boolean) => { switch (flag) { case true: case false: return true; } };
  const withDefault = (flag: boolean = true): boolean => flag;
  const readOptions = ({ flag }: { flag: boolean } = { flag: true }): boolean => flag;
  let value: "a" | "b" | null = "a";
  const make = () => { if (value === null) throw new Error("missing"); return () => value; };
  const first = make();
  value = null;
  const early = first();
  value = "b";
  const second = make();
  return { empty: empty[0], shortened: pair[1], tail, reversed: reversed[0], captured: capture(), forwarded: firstTuple(reversed), grown: grown[Number("2")], optional: read(), present: read(true), defaulted: withDefault(), moduleDefaulted: defaultFlag(), moduleProvided: defaultFlag({ flag: false }), destructuredDefault: readOptions(), destructuredProvided: readOptions({ flag: false }), early, late: second() };
}
function stableCapturedRead(): "a" | "b" { let value: "a" | "b" | null = null; value = "a"; if (value === null) throw new Error("missing value"); const read = (): "a" | "b" => value; return read(); }
function loopGuard(): "a" | "b" { let value: "a" | "b" | null = "a"; let i = 0; while (true) { if (value === null) { value = "b"; } else { if (i === 1) return value; value = null; i++; } } }
function nullableArguments(absent: { count: number } | null) {
  let present: { count: number } | null = { count: 0 };
  const mutate = (value: { count: number } | null, extra: number[]) => { if (value !== null) value.count++; };
  mutate(present, []);
  const local = present?.count;
  const replace = (value: { count: number } | null) => { value = { count: 9 }; };
  replace(present);
  mutateNullable(present, []);
  const module = present?.count;
  const extra = () => { if (present !== null) present.count++; return []; };
  mutate(present, extra());
  mutate(absent, []);
  let before = { count: 0 };
  const peek = (value: { count: number }, extra: number[]) => value.count;
  const rebind = () => { before = { count: 9 }; return []; };
  const earlier = peek(before, rebind());
  const record: { inner: { count: number } | null, keep: { count: number } | null } = { inner: { count: 0 }, keep: { count: 3 } };
  if (record.keep !== null) { record.inner = null; return { local, module, absent: absent?.count, sibling: record.keep.count, stable: stableCapturedRead(), unchecked: uncheckedReads(), ordered: present?.count, looped: loopGuard(), earlier }; }
  throw new Error("missing sibling");
}
function formatNumeric(value: 0 | -1): string { return value.toFixed(0); }
function finiteNumber(value: 0 | -1): boolean { switch (value) { case 0: return true; case -1: return false; } }
function finiteFunction(): true { const value = `show`; const predicates = [(): true => !false]; const first = 0; const flag = !first; switch (value) { case templateResult(): switch (flag) { case true: if (!finiteNumber(0) || finiteNumber(-1)) deny(); return predicates[0]!() && !0; } } }
function constDefault(): boolean { const { value = "show", enabled = true } = { value: undefined, enabled: undefined }; switch (enabled) { case YES: switch (value) { case SHOW: return finiteFunction(); } } }
function allowed(flag: boolean | null): boolean { const NO = false; switch (flag) { case YES: return constDefault(); case NO: deny(); case NIL: return false; } }
function visibleRole(ctx: FieldContext): boolean { if (ctx.user === null) return true; switch (ctx.user.role) { case "guest": case "subscriber": return false; case "author": case "editor": case "admin": return true; } }
function visible(value: unknown): boolean { const decision: `hide` | `show` = value === "private" ? "hide" : "show"; const VISIBLE = "show"; switch (decision) { case HIDE: return false; case VISIBLE: return true; } }
function visibleField(ctx: FieldContext): boolean { switch (ctx.op) { case "read": { if (ctx.data.label === "error") deny(); const decision = ctx.user === null ? 0 : 1; switch (decision) { case 0: return visible(ctx.data.label); case 1: return false; } } case "create": return false; case "update": return true; } }
function maybeFirst() { const values = ["a"]; values.unshift("b"); switch (values[0]) { case "a": return true; } }
function maybeDefault() { const { words = ["a"] } = { words: undefined }; words.unshift("b"); switch (words[0]) { case "a": return true; } }
function maybeFunction() { const predicates = [() => true]; predicates.unshift(() => false); const flag = predicates[0]!(); switch (flag) { case true: return true; } }
const audit = table({ id: id(), note: text().notNull() }, { agents: false });
const authors = collection({ id: id(), name: text().notNull(), email: email().access({ read: "editor", create: true, update: ctx => ctx.user !== null }), avatar: media().access({ read: "authenticated" }) }, { title: "name", uid: true });
const posts = collection({
  id: id(), title: text().notNull().localized(), content: richText().localized(), slug: slug({ source: "title" }),
  authorId: integer().references(() => authors.id), deck: file({ bucket: "decks" }),
  seo: group({ fields: { kind: text({ enum: ["a", "b"] }), enabled: boolean(), label: text().access({ read: visibleField }).showIf({ OR: [{ kind: { in: ["a", "b"] } }, { enabled: { eq: true } }] }) } }).showIf({ status: "published" }),
  items: repeater({ fields: { enabled: boolean(), label: text().showIf({ enabled: true }) } }),
  sections: blocks({ layouts: { hero: { kind: text(), label: text().access({ update: ctx => { switch (ctx.op) { case "read": throw new Error("not an update"); case "create": return false; case "update": return visibleRole(ctx); } } }).showIf({ kind: { ne: "hidden" } }) } } }),
  tags: select({ options: ["news", "guide"], multiple: true }).localized(), meta: json().localized(),
}, { sync: "content/./posts/*.md", agents: true });
const members = userProjection({ id: id(), email: email().notNull().unique().max(191), name: text() }, { access: { read: "self", create: "anyone", update: "self", delete: "admin" } });
export const collections = { authors, posts };
export const tables = { audit };
export const users = { members };
export const entities = { ...collections, ...tables, ...users };
export default defineConfig({
  name: "phase2", collections, tables, users,
  uploads: { backend: "s3", bucket: env("UPLOAD_BUCKET"), region: "us-east-1", endpoint: env("UPLOAD_ENDPOINT"), pathStyle: true, prefix: "phase2", credentials: { accessKeyId: env("UPLOAD_KEY"), secretAccessKey: env("UPLOAD_SECRET") } },
  locales: { default: "en", all: ["en", "de"] }, media: { sizes: { thumb: { width: 300, height: 300, fit: "cover" }, wide: { width: 1600 } } },
  files: { decks: files("decks", { accept: ["application/pdf", "image/*"], maxBytes: 20000000, access: { read: "owner", create: ctx => ctx.user !== null, delete: "owner" } }) },
  globals: { settings: global("settings", { title: text().default("Hello") }, { agents: false }) },
  jobs: { sendWelcome: job({ input: { email: email().notNull(), payload: json().$type<{ message: string }>().notNull(), data: group({ fields: { label: text().default("welcome"), payload: json().$type<{ suffix: string }>() } }) }, retries: 5, agents: true, handler: async (input, ctx: JobCtx) => { let choose = yes; choose = no; if (visible(input.email) && !(await choose())) { await db.insert(audit).values({ note: input.payload.message + ":" + ctx.jobId + ":" + ctx.attempt + ":" + (input.data?.payload?.suffix ?? "") }); } } }) },
  webhooks: [{ url: env("HOOK_URL"), secret: env("HOOK_SECRET"), events: ["posts.created", "posts.updated", "posts.deleted", "*"] }, { url: "https://example.com/hook", secret: env("OTHER_SECRET"), events: ["members.created"] }],
  actions: {
    inbound: action({ input: { allow: boolean().notNull().default(true) }, idempotent: true, agents: false, signature: { secret: env("STRIPE_WEBHOOK_SECRET"), header: "stripe-signature", scheme: "hmac-sha256" }, handler: (input, ctx): boolean => { if (ctx.user === null) return false; switch (ctx.user.role) { case "guest": case "subscriber": return false; case "author": case "editor": case "admin": return allowed(input.allow) && !allowed(null); } } }),
    widened: action({ input: {}, handler: () => {
      const values = ["a"]; values.unshift("b");
      let choice = values.length > 0 ? "a" : "b"; choice = "c";
      const finite: ("a" | "b")[] = ["a"]; finite.push("b");
      const nested = [1].map(() => ["a"]).map((items: string[]) => { items.unshift("b"); return items; });
      const callbacks = [1].map(() => ["a"]).map(items => { items.unshift("b"); switch (items[0]) { case "a": return true; } });
      const pairs: [string, number][] = [["a", 2]];
      const tuples = pairs.map(([label = "", count = 0]) => label.repeat(count));
      const optional: { pair?: [string, number], words?: ("a" | "b")[] } = {};
      const { pair = ["a", 2], words: finiteDefaults = ["a"] } = optional;
      finiteDefaults.push("b");
      const defaultTuple = pair[0]!.repeat(pair[1]!);
      const reduced = ["a"].reduce((acc, value) => acc + value);
      const reducedNested = [1].map(() => ["a"]).reduce((acc, value) => acc.concat(value));
      const numeric = updateNumeric(1);
      const effects = { captured: captureNumeric(1), invoked: invokeNumeric(1), loop: loopNumeric(1), helper: helperNumeric(), maybeCaptured: maybeCapture(1), maybeHelper: maybeHelper(), shadow: shadowNumeric(1), early: earlyNumeric(0), byValue: byValueNumeric(1), passed: passedNumeric(), callback: callbackNumeric(), defaulted: defaultNumeric(1), localDefaulted: localDefaultNumeric(1), logical: logicalNumeric(1), nullableArguments: nullableArguments(null) };
      const formatted = formatNumeric(-1);
      const numericChoice = values.length > 0 ? 0 : 1;
      const inferredNumber = numericChoice.toString();
      const selected = finite[0]; if (selected === undefined) throw new Error("missing element"); switch (selected) { case "a": case "b": return { values, choice, finite: finite.map((value: "a" | "b") => value), nested, callbacks, tuples, finiteDefaults, defaultTuple, reduced, reducedNested, numeric, effects, formatted, inferredNumber, functionMaybe: maybeFunction(), defaultMaybe: maybeDefault(), maybe: maybeFirst() }; }
    } }),
  },
});
