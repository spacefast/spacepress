import { collection, cron, defineConfig, env, extend, f, files, global, job, mutation, table } from "spacepress";
import { type JobCtx, type FieldAccessCtx, type Locale, type LocalizedColumns } from "spacepress";
import { db } from "spacepress/server";
import { expectType, type Equal } from "./inference";

export const audit = table({ note: f.text() }, { agents: false });
export const authors = collection({ name: f.text(), email: f.email().optional().access({ read: "editor", create: true, update: ctx => ctx.user !== null }) }, { title: "name", uid: true, access: { create: ctx => ctx.data?.uid !== "reserved" } });
export const decks = files({ accept: ["application/pdf", "image/*"], maxBytes: 20000000, access: { read: "owner", create: ctx => ctx.user !== null, delete: "owner" } });

export const posts = collection({
  title: f.text().localized(), content: f.richText().localized().optional(), slug: f.slug({ source: "title" }).optional(),
  authorId: f.ref(authors).optional().onDelete("restrict"), deck: f.file(decks).optional(),
  seo: f.group({ kind: f.select(["a", "b"]).optional(), enabled: f.boolean().optional(), label: f.text().optional().access({ read: ctx => ctx.data.label !== "private" }).showIf({ OR: [{ kind: { in: ["a", "b"] } }, { enabled: { eq: true } }] }) }).optional().showIf({ status: "published" }),
  items: f.repeater({ enabled: f.boolean().optional(), label: f.text().optional().showIf({ enabled: true }) }).optional(),
  sections: f.blocks({ hero: { kind: f.text().optional(), label: f.text().optional().access({ update: ctx => ctx.op === "update" }).showIf({ kind: { ne: "hidden" } }) } }).optional(),
  tags: f.select(["news", "guide"]).many().localized().optional(), meta: f.json().localized().optional(),
}, { sync: "content/./posts/*.md", agents: true, access: { create: ctx => ctx.data?.locale === "en" && ctx.data.uid !== "reserved" } });
export const members = extend("users", { fields: { displayBio: f.text().optional() }, uid: true, access: { read: "self", create: ctx => ctx.data?.uid !== "reserved", update: "self", delete: "admin" } });
export const settings = global({ title: f.text().default("Hello") }, { agents: false });
export const sendWelcome = job({ retries: 5, agents: true }, async (ctx, input: { email: string; data?: { label?: string } }) => {
  await ctx.db.posts.list();
  const id = await ctx.once("key", async () => 42);
  expectType<Equal<typeof id, number>>();
  // @ts-expect-error once keys are strings
  await ctx.once(42, () => true);
  void (input.email + ":" + ctx.jobId + ":" + ctx.attempt);
});
export const hourly = job({ every: "1h" }, async () => {});
export const nightly = cron("0 3 * * *", async (ctx) => { void ctx.attempt; });
// @ts-expect-error a repeat is a number and a unit
job({ every: "hourly" }, async () => {});
export const inbound = mutation({ idempotent: true, agents: false, signature: { secret: env("STRIPE_WEBHOOK_SECRET"), header: "stripe-signature", scheme: "hmac-sha256" } }, () => true);
export default defineConfig({
  name: "phase2",
  locales: { default: "en", all: ["en", "de"] }, media: { sizes: { thumb: { width: 300, height: 300, fit: "cover" }, wide: { width: 1600 } } },
  webhooks: [{ url: env("HOOK_URL"), secret: env("HOOK_SECRET"), events: ["posts.created", "posts.updated", "posts.deleted", "*"] }, { url: "https://example.com/hook", secret: env("OTHER_SECRET"), events: ["members.created"] }],
});

const localizedBlocks = table({
  sections: f.blocks({ hero: { heading: f.text().localized().optional() }, quote: { body: f.text().optional() } }).optional(),
}, { uid: true, access: { create: ctx => ctx.data?.locale === "en" && ctx.data.uid !== "reserved" } });
type LocalizedBlockRow = typeof localizedBlocks.$inferSelect;
expectType<Equal<LocalizedBlockRow["locale"], Locale>>();
expectType<Equal<LocalizedBlockRow["translations"], LocalizedColumns["translations"]>>();

// A required synced column (price): translations may omit it, fresh rows may not.
const priced = table({ title: f.text().localized(), price: f.integer(), handle: f.slug() });
const pricedTrans: typeof priced.$inferInsert = { title: "Preis", locale: "de", translationOf: 1, handle: "preis" };
// @ts-expect-error a fresh row must give its required synced column
const pricedMissing: typeof priced.$inferInsert = { title: "Price", handle: "price" };
// @ts-expect-error a slug is per row: a translation must give its own
const pricedNoSlug: typeof priced.$inferInsert = { title: "Prix", locale: "de", translationOf: 1 };
void [pricedTrans, pricedMissing, pricedNoSlug];

const roles = table({ role: f.text().optional(), password: f.text().optional() });
const roleNames = table({ role: f.text().optional() });
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
  const postRow: typeof posts.$inferSelect = null!;
  expectType<Equal<typeof postRow.locale, Locale>>();
  expectType<Equal<typeof postRow.translations, LocalizedColumns["translations"]>>();
  expectType<Equal<typeof postRow.uid, string>>();
  const memberRow: typeof members.$inferSelect = null!;
  expectType<Equal<typeof memberRow.role, import("spacepress").Role>>();
  await db.posts.list({ locale: "de" });
  await db.posts.get(1, { locale: "*" });
  // @ts-expect-error locale is narrowed through the registered config
  await db.posts.list({ locale: "fr" });
}
// @ts-expect-error values cannot be translated
f.integer().localized();
// @ts-expect-error fields are required by default and `.notNull()` is gone
f.text().notNull();
// @ts-expect-error every kind has an integer id; there is no primary-key modifier
f.text().primaryKey();
const field: import("spacepress").FieldRule = ctx => {
  expectType<Equal<typeof ctx, FieldAccessCtx>>();
  return ctx.op === "read" && ctx.data.visible === true;
};
const jobContext = (ctx: JobCtx) => ctx.jobId + ctx.attempt;
void [surface, field, jobContext];
