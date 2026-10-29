import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, blocks, json, select, file, files, job, env, global, action, defineConfig, db } from "zero";
import type { FieldAccessCtx as FieldContext, JobCtx } from "zero";
function deny(): never { throw new Error("denied"); }
async function yes() { return true; }
async function no() { return false; }
const HIDE = "hide";
const SHOW = "show";
const YES = true;
const NIL = null;
function templateResult(): "show" { return `show`; }
function updateNumeric(value: 0 | 1) { value++; if (value > 0) { value--; } value += 1; let record: { count: 0 | 1, values: (0 | 1)[], keep: 0 } = { count: 1, values: [1], keep: 0 }; if (value > 0) { record.count++; record.values[0]--; } return { value, count: record.count, item: record.values[0], keep: record.keep }; }
function captureNumeric(value: 0 | 1) { const read = () => value; value++; return read(); }
function invokeNumeric(value: 0 | 1) { const bump = () => { value++; }; bump(); return value; }
function loopNumeric(value: 0 | 1) { while (true) { if (value > 1) return value; value++; } }
function bumpNumeric(record: { count: 0 | 1, keep: 0 }) { record.count++; }
function forwardNumeric(record: { count: 0 | 1, keep: 0 }) { bumpNumeric(record); }
function helperNumeric() { forwardNumeric({ count: 1, keep: 0 }); const record: { count: 0 | 1, keep: 0 } = { count: 1, keep: 0 }; const read = () => record.count; forwardNumeric(record); const bump = (value: { count: 0 | 1, keep: 0 }) => { value.count++; }; bump(record); return { count: record.count, captured: read(), keep: record.keep }; }
function maybeCapture(value: 0 | 1) { const read = () => value; value++; switch (read()) { case 0: case 1: return true; } }
function maybeHelper() { let record: { count: 0 | 1, keep: 0 } = { count: 1, keep: 0 }; bumpNumeric(record); switch (record.count) { case 0: case 1: return true; } }
function earlyNumeric(value: 0 | 1): 0 | 1 { if (value === 0) return value; value++; return 1; }
function byValueNumeric(value: 0 | 1): 0 | 1 { const unused = () => { value++; }; captureNumeric(value); return value; }
function shadowNumeric(value: 0 | 1) { const read = () => value; { let value: 0 | 1 = 1; value++; } return read(); }
function formatNumeric(value: 0 | -1): string { return value.toFixed(0); }
function finiteNumber(value: 0 | -1): boolean { switch (value) { case 0: return true; case -1: return false; } }
function finiteFunction(): true { const value = `show`; const predicates = [(): true => !false]; const zero = 0; const flag = !zero; switch (value) { case templateResult(): switch (flag) { case true: if (!finiteNumber(0) || finiteNumber(-1)) deny(); return predicates[0]() && !0; } } }
function constDefault(): boolean { const { value = "show", enabled = true } = { value: undefined, enabled: undefined }; switch (enabled) { case YES: switch (value) { case SHOW: return finiteFunction(); } } }
function allowed(flag: boolean | null): boolean { const NO = false; switch (flag) { case YES: return constDefault(); case NO: deny(); case NIL: return false; } }
function visibleTarget(ctx: FieldContext): boolean { switch (ctx.target) { case "wp": return false; case "standalone": if (ctx.user === null) return true; switch (ctx.user.role) { case "guest": case "subscriber": return false; case "author": case "editor": case "admin": return true; } } }
function visible(value: unknown): boolean { const decision: `hide` | `show` = value === "private" ? "hide" : "show"; const VISIBLE = "show"; switch (decision) { case HIDE: return false; case VISIBLE: return true; } }
function visibleField(ctx: FieldContext): boolean { switch (ctx.op) { case "read": if (ctx.data.label === "error") deny(); const decision = ctx.user === null ? 0 : 1; switch (decision) { case 0: return visible(ctx.data.label); case 1: return false; } case "create": return false; case "update": return true; } }
function maybeFirst() { const values = ["a"]; values.unshift("b"); switch (values[0]) { case "a": return true; } }
function maybeDefault() { const { words = ["a"] } = { words: undefined }; words.unshift("b"); switch (words[0]) { case "a": return true; } }
function maybeFunction() { const predicates = [() => true]; predicates.unshift(() => false); const flag = predicates[0](); switch (flag) { case true: return true; } }
const audit = collection("audit", { id: id(), note: text().notNull() }, { editor: false, agents: false });
const authors = collection("authors", { id: id(), name: text().notNull(), email: email().access({ read: "editor", create: true, update: ctx => ctx.user !== null }) }, { title: "name", uid: true });
const posts = collection("posts", {
  id: id(), title: text().notNull().localized(), content: richText().localized(), slug: slug({ source: "title" }),
  authorId: integer().references(() => authors.id), deck: file({ bucket: "decks" }),
  seo: group({ fields: { kind: text({ enum: ["a", "b"] }), enabled: boolean(), label: text().access({ read: visibleField }).showIf({ OR: [{ kind: { in: ["a", "b"] } }, { enabled: { eq: true } }] }) } }).showIf({ status: "published" }),
  items: repeater({ fields: { enabled: boolean(), label: text().showIf({ enabled: true }) } }),
  sections: blocks({ layouts: { hero: { kind: text(), label: text().access({ update: ctx => { switch (ctx.op) { case "read": throw new Error("not an update"); case "create": return false; case "update": return visibleTarget(ctx); } } }).showIf({ kind: { ne: "hidden" } }) } } }),
  tags: select({ options: ["news", "guide"], multiple: true }).localized(), meta: json().localized(),
}, { sync: "content/./posts/*.md", agents: true });
const members = collection("members", { id: id(), email: email().notNull().unique().max(191), name: text() }, { auth: true, access: { read: "self", create: "anyone", update: "self", delete: "admin" } });
export const schema = { audit, authors, posts, members };
export default defineConfig({
  name: "phase2", schema,
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
      const nested = [1].map(() => ["a"]).map(items => { items.unshift("b"); return items; });
      const callbacks = [1].map(() => ["a"]).map(items => { items.unshift("b"); switch (items[0]) { case "a": return true; } });
      const pairs: [string, number][] = [["a", 2]];
      const tuples = pairs.map(([label, count]) => label.repeat(count));
      const optional: { pair?: [string, number], words?: ("a" | "b")[] } = {};
      const { pair = ["a", 2], words: finiteDefaults = ["a"] } = optional;
      finiteDefaults.push("b");
      const defaultTuple = pair[0].repeat(pair[1]);
      const reduced = ["a"].reduce((acc, value) => acc + value);
      const reducedNested = [1].map(() => ["a"]).reduce((acc, value) => acc.concat(value));
      const numeric = updateNumeric(1);
      const effects = { captured: captureNumeric(1), invoked: invokeNumeric(1), loop: loopNumeric(1), helper: helperNumeric(), maybeCaptured: maybeCapture(1), maybeHelper: maybeHelper(), shadow: shadowNumeric(1), early: earlyNumeric(0), byValue: byValueNumeric(1) };
      const formatted = formatNumeric(-1);
      const numericChoice = values.length > 0 ? 0 : 1;
      const inferredNumber = numericChoice.toString();
      const selected = finite[0]; switch (selected) { case "a": case "b": return { values, choice, finite, nested, callbacks, tuples, finiteDefaults, defaultTuple, reduced, reducedNested, numeric, effects, formatted, inferredNumber, functionMaybe: maybeFunction(), defaultMaybe: maybeDefault(), maybe: maybeFirst() }; }
    } }),
  },
});
