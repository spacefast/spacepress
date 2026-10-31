import { collection, id, text, email, integer, boolean, richText, slug, group, repeater, blocks, json, select, file, files, job, env, global, action, defineConfig, db } from "zero";
const audit = collection("audit", { id: id(), note: text().notNull() }, { editor: false, agents: false });
const authors = collection("authors", { id: id(), name: text().notNull(), email: email().access({ read: "editor", create: true, update: ctx => ctx.user !== null }) }, { title: "name", uid: true, access: { create: ctx => ctx.data?.uid !== "reserved" } });
const posts = collection("posts", {
  id: id(), title: text().notNull().localized(), content: richText().localized(), slug: slug({ source: "title" }),
  authorId: integer().references(() => authors.id), deck: file({ bucket: "decks" }),
  seo: group({ fields: { kind: text({ enum: ["a", "b"] }), enabled: boolean(), label: text().access({ read: ctx => ctx.data.label !== "private" }).showIf({ OR: [{ kind: { in: ["a", "b"] } }, { enabled: { eq: true } }] }) } }).showIf({ status: "published" }),
  items: repeater({ fields: { enabled: boolean(), label: text().showIf({ enabled: true }) } }),
  sections: blocks({ layouts: { hero: { kind: text(), label: text().access({ update: ctx => ctx.op === "update" }).showIf({ kind: { ne: "hidden" } }) } } }),
  tags: select({ options: ["news", "guide"], multiple: true }).localized(), meta: json().localized(),
}, { sync: "content/./posts/*.md", agents: true, access: { create: ctx => ctx.data?.locale === "en" && ctx.data.uid !== "reserved" } });
const members = collection("members", { id: id(), email: email().notNull().unique().max(191), name: text() }, { auth: true, uid: true, access: { read: "self", create: ctx => ctx.data?.uid !== "reserved", update: "self", delete: "admin" } });
export const schema = { audit, authors, posts, members };
export default defineConfig({
  name: "phase2", schema,
  locales: { default: "en", all: ["en", "de"] }, media: { sizes: { thumb: { width: 300, height: 300, fit: "cover" }, wide: { width: 1600 } } },
  files: { decks: files("decks", { accept: ["application/pdf", "image/*"], maxBytes: 20000000, access: { read: "owner", create: ctx => ctx.user !== null, delete: "owner" } }) },
  globals: { settings: global("settings", { title: text().default("Hello") }, { agents: false }) },
  jobs: { sendWelcome: job({ input: { email: email().notNull(), data: group({ fields: { label: text().default("welcome") } }) }, retries: 5, agents: true, handler: async (input, ctx) => { await db.insert(audit).values({ note: input.email + ":" + ctx.jobId + ":" + ctx.attempt }); } }) },
  webhooks: [{ url: env("HOOK_URL"), secret: env("HOOK_SECRET"), events: ["posts.created", "posts.updated", "posts.deleted", "*"] }, { url: "https://example.com/hook", secret: env("OTHER_SECRET"), events: ["members.created"] }],
  actions: { inbound: action({ input: {}, idempotent: true, agents: false, signature: { secret: env("STRIPE_WEBHOOK_SECRET"), header: "stripe-signature", scheme: "hmac-sha256" }, handler: () => true }) },
});

import { jobs, once, type JobCtx, type FieldAccessCtx, type Locale, type LocalizedColumns } from "zero";
import { expectType, type Equal } from "./inference";

const localizedBlocks = collection("localized_blocks", {
  id: id(), sections: blocks({ layouts: { hero: { heading: text().localized() }, quote: { body: text() } } }),
}, { editor: false, uid: true, access: { create: ctx => ctx.data?.locale === "en" && ctx.data.uid !== "reserved" } });
type LocalizedBlockRow = typeof localizedBlocks.$inferSelect;
expectType<Equal<LocalizedBlockRow["locale"], Locale>>();
expectType<Equal<LocalizedBlockRow["translations"], LocalizedColumns["translations"]>>();

// A required synced column (price): translations may omit it, fresh rows may not.
const priced = collection("priced", { id: id(), title: text().notNull().localized(), price: integer().notNull(), handle: slug().notNull() }, { editor: false });

// A text primary key not named `id`: translation ids are that key's type, and a translation gives its own key.
const skus = collection("skus", { code: text().primaryKey(), title: text().notNull().localized(), price: integer().notNull() }, { editor: false });
expectType<Equal<(typeof skus.$inferSelect)["translations"], Partial<Record<Locale, string>>>>();

// Primary-key builders still fit annotations and generic helpers written without the flag.
const annotated: import("zero").ColumnBuilder<"id", number, true, true> = id();
const acceptBuilder = <T extends import("zero").ColumnBuilder>(c: T) => c;
acceptBuilder(text().primaryKey());
void annotated;

const roles = collection("roles", { id: id(), role: text(), password: text() }, { editor: false });
const roleNames = collection("role_names", { id: id(), role: text() }, { editor: false });
const roleInsert: typeof roles.$inferInsert = { role: "item", password: null };
// @ts-expect-error ordinary role columns do not enable a virtual password input
const unsupportedPassword: typeof roleNames.$inferInsert = { role: "item", password: "secret" };
void [roleInsert, unsupportedPassword];

async function surface() {
  await jobs.sendWelcome.enqueue({ email: "a@example.com" }, { delay: 30, key: "welcome" });
  // @ts-expect-error registered job input is checked
  await jobs.sendWelcome.enqueue({ email: 42 });
  // @ts-expect-error no such registered job
  await jobs.missing.enqueue({});
  const id = await once("key", async () => 42);
  expectType<Equal<typeof id, number>>();
  // @ts-expect-error once keys are strings
  await once(42, () => true);
  const row = (await db.insert(posts).values({ title: "Hallo", locale: "de", translationOf: 1 }).returning())[0];
  // A translation copies synced columns (authorId here), a fresh row still needs its required ones.
  await db.insert(priced).values({ title: "Preis", locale: "de", translationOf: 1, handle: "preis" });
  // @ts-expect-error a fresh row must give its required synced column
  await db.insert(priced).values({ title: "Price", handle: "price" });
  // @ts-expect-error a slug is per row: a translation must give its own
  await db.insert(priced).values({ title: "Prix", locale: "de", translationOf: 1 });
  await db.insert(skus).values({ code: "sku-de", title: "Preis", locale: "de", translationOf: "sku-en" });
  // @ts-expect-error translationOf is the text key, not a number
  await db.insert(skus).values({ code: "sku-de", title: "Preis", locale: "de", translationOf: 1 });
  // @ts-expect-error the primary key is per row: a translation must give its own
  await db.insert(skus).values({ title: "Preis", locale: "de", translationOf: "sku-en" });
  expectType<Equal<typeof row.locale, Locale>>();
  expectType<Equal<typeof row.translations, LocalizedColumns["translations"]>>();
  expectType<Equal<typeof row.uid, string>>();
  const member = (await db.insert(members).values({ email: "a@example.com", password: "long password" }).returning())[0];
  expectType<Equal<typeof member.role, import("zero").Role>>();
  // @ts-expect-error locale is immutable after create
  await db.update(posts).set({ locale: "de" });
  await db.query.posts.findMany({ locale: "de" });
  await db.query.posts.findFirst({ locale: "*" });
  // @ts-expect-error locale is narrowed through the registered config
  await db.query.posts.findMany({ locale: "fr" });
}
// @ts-expect-error values cannot be translated
integer().localized();
// @ts-expect-error ids cannot have field access rules
id().access({ read: false });
const field: import("zero").FieldRule = ctx => {
  expectType<Equal<typeof ctx, FieldAccessCtx>>();
  return ctx.op === "read" && ctx.data.visible === true;
};
const jobContext = (ctx: JobCtx) => ctx.jobId + ctx.attempt;
void [surface, field, jobContext];
