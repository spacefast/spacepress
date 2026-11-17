import { collection, text, email, integer, boolean, richText, slug, group, repeater, blocks, json, select, file, files, job, cron, env, global, defineConfig, db , table, userProjection, ref, mutation } from "typedpress";
export const audit = table({ note: text() }, { agents: false });
export const authors = collection({ name: text(), email: email().optional().access({ read: "editor", create: true, update: ctx => ctx.user !== null }) }, { title: "name", uid: true, access: { create: ctx => ctx.data?.uid !== "reserved" } });
export const decks = files({ accept: ["application/pdf", "image/*"], maxBytes: 20000000, access: { read: "owner", create: ctx => ctx.user !== null, delete: "owner" } });

export const posts = collection({
  title: text().localized(), content: richText().localized().optional(), slug: slug({ source: "title" }).optional(),
  authorId: ref(authors).optional().onDelete("restrict"), deck: file(decks).optional(),
  seo: group({ kind: select(["a", "b"]).optional(), enabled: boolean().optional(), label: text().optional().access({ read: ctx => ctx.data.label !== "private" }).showIf({ OR: [{ kind: { in: ["a", "b"] } }, { enabled: { eq: true } }] }) }).optional().showIf({ status: "published" }),
  items: repeater({ enabled: boolean().optional(), label: text().optional().showIf({ enabled: true }) }).optional(),
  sections: blocks({ hero: { kind: text().optional(), label: text().optional().access({ update: ctx => ctx.op === "update" }).showIf({ kind: { ne: "hidden" } }) } }).optional(),
  tags: select(["news", "guide"]).many().localized().optional(), meta: json().localized().optional(),
}, { sync: "content/./posts/*.md", agents: true, access: { create: ctx => ctx.data?.locale === "en" && ctx.data.uid !== "reserved" } });
export const members = userProjection({ email: email().unique().max(191), name: text().optional() }, { uid: true, access: { read: "self", create: ctx => ctx.data?.uid !== "reserved", update: "self", delete: "admin" } });
export const settings = global({ title: text().default("Hello") }, { agents: false });
export const sendWelcome = job({ retries: 5, agents: true }, async (input: { email: string; data?: { label?: string } }, ctx) => { await db.insert(audit).values({ note: input.email + ":" + ctx.jobId + ":" + ctx.attempt }); });
export const hourly = job({ every: "1h" }, async () => {});
export const nightly = cron("0 3 * * *", async (_input, ctx) => { void ctx.attempt; });
// @ts-expect-error a repeat is a number and a unit
job({ every: "hourly" }, async () => {});
export const inbound = mutation({ idempotent: true, agents: false, signature: { secret: env("STRIPE_WEBHOOK_SECRET"), header: "stripe-signature", scheme: "hmac-sha256" } }, () => true);
export default defineConfig({
  name: "phase2",
  locales: { default: "en", all: ["en", "de"] }, media: { sizes: { thumb: { width: 300, height: 300, fit: "cover" }, wide: { width: 1600 } } },
  webhooks: [{ url: env("HOOK_URL"), secret: env("HOOK_SECRET"), events: ["posts.created", "posts.updated", "posts.deleted", "*"] }, { url: "https://example.com/hook", secret: env("OTHER_SECRET"), events: ["members.created"] }],
});

import { once, type JobCtx, type FieldAccessCtx, type Locale, type LocalizedColumns } from "typedpress";
import { expectType, type Equal } from "./inference";

const localizedBlocks = table({
  sections: blocks({ hero: { heading: text().localized().optional() }, quote: { body: text().optional() } }).optional(),
}, { uid: true, access: { create: ctx => ctx.data?.locale === "en" && ctx.data.uid !== "reserved" } });
type LocalizedBlockRow = typeof localizedBlocks.$inferSelect;
expectType<Equal<LocalizedBlockRow["locale"], Locale>>();
expectType<Equal<LocalizedBlockRow["translations"], LocalizedColumns["translations"]>>();

// A required synced column (price): translations may omit it, fresh rows may not.
const priced = table({ title: text().localized(), price: integer(), handle: slug() });

const roles = table({ role: text().optional(), password: text().optional() });
const roleNames = table({ role: text().optional() });
const roleInsert: typeof roles.$inferInsert = { role: "item", password: null };
// @ts-expect-error ordinary role columns do not enable a virtual password input
const unsupportedPassword: typeof roleNames.$inferInsert = { role: "item", password: "secret" };
void [roleInsert, unsupportedPassword];

async function surface() {
  await sendWelcome.enqueue({ email: "a@example.com" }, { delay: 30, key: "welcome" });
  // @ts-expect-error a job's input is its handler's parameter type
  await sendWelcome.enqueue({ email: 42 });
  // @ts-expect-error enqueue options are delay and key
  await sendWelcome.enqueue({ email: "a@example.com" }, { at: 30 });
  await nightly.enqueue({});
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
  expectType<Equal<typeof row.locale, Locale>>();
  expectType<Equal<typeof row.translations, LocalizedColumns["translations"]>>();
  expectType<Equal<typeof row.uid, string>>();
  const member = (await db.insert(members).values({ email: "a@example.com", password: "long password" }).returning())[0];
  expectType<Equal<typeof member.role, import("typedpress").Role>>();
  // @ts-expect-error locale is immutable after create
  await db.update(posts).set({ locale: "de" });
  await db.query.posts.findMany({ locale: "de" });
  await db.query.posts.findFirst({ locale: "*" });
  // @ts-expect-error locale is narrowed through the registered config
  await db.query.posts.findMany({ locale: "fr" });
}
// @ts-expect-error values cannot be translated
integer().localized();
// @ts-expect-error fields are required by default and `.notNull()` is gone
text().notNull();
// @ts-expect-error every kind has an integer id; there is no primary-key modifier
text().primaryKey();
const field: import("typedpress").FieldRule = ctx => {
  expectType<Equal<typeof ctx, FieldAccessCtx>>();
  return ctx.op === "read" && ctx.data.visible === true;
};
const jobContext = (ctx: JobCtx) => ctx.jobId + ctx.attempt;
void [surface, field, jobContext];
