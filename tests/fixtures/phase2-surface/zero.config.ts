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
function finiteFunction(): true { const value = `show`; const predicates = [(): true => true]; const flag = predicates[0](); switch (value) { case templateResult(): switch (flag) { case true: return true && true; } } }
function constDefault(): boolean { const { value = "show", enabled = true } = { value: undefined, enabled: undefined }; switch (enabled) { case YES: switch (value) { case SHOW: return finiteFunction(); } } }
function allowed(flag: boolean | null): boolean { const NO = false; switch (flag) { case YES: return constDefault(); case NO: deny(); case NIL: return false; } }
function visibleTarget(ctx: FieldContext): boolean { switch (ctx.target) { case "wp": return false; case "standalone": return true; } }
function visible(value: unknown): boolean { const decision: `hide` | `show` = value === "private" ? "hide" : "show"; const VISIBLE = "show"; switch (decision) { case HIDE: return false; case VISIBLE: return true; } }
function visibleField(ctx: FieldContext): boolean { switch (ctx.op) { case "read": if (ctx.data.label !== "error") return visible(ctx.data.label); deny(); case "create": return false; case "update": return true; } }
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
    inbound: action({ input: { allow: boolean().notNull().default(true) }, idempotent: true, agents: false, signature: { secret: env("STRIPE_WEBHOOK_SECRET"), header: "stripe-signature", scheme: "hmac-sha256" }, handler: input => allowed(input.allow) && !allowed(null) }),
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
      const selected = finite[0]; switch (selected) { case "a": case "b": return { values, choice, finite, nested, callbacks, tuples, finiteDefaults, defaultTuple, reduced, reducedNested, functionMaybe: maybeFunction(), defaultMaybe: maybeDefault(), maybe: maybeFirst() }; }
    } }),
  },
});
