import { collection, text, email, integer, boolean, richText, slug, group, repeater, blocks, json, select, file, files, job, env, global, action, defineConfig, db , table, userProjection, ref } from "first";
const audit = table({ note: text() }, { agents: false });
const authors = collection({ name: text(), email: email().optional().access({ read: "editor", create: true, update: ctx => ctx.user !== null }) }, { title: "name", uid: true, access: { create: ctx => ctx.data?.uid !== "reserved" } });
const posts = collection({
  title: text().localized(), content: richText().localized().optional(), slug: slug({ source: "title" }).optional(),
  authorId: ref(authors).optional().onDelete("restrict"), deck: file({ bucket: "decks" }).optional(),
  seo: group({ kind: select(["a", "b"]).optional(), enabled: boolean().optional(), label: text().optional().access({ read: ctx => ctx.data.label !== "private" }).showIf({ OR: [{ kind: { in: ["a", "b"] } }, { enabled: { eq: true } }] }) }).optional().showIf({ status: "published" }),
  items: repeater({ enabled: boolean().optional(), label: text().optional().showIf({ enabled: true }) }).optional(),
  sections: blocks({ hero: { kind: text().optional(), label: text().optional().access({ update: ctx => ctx.op === "update" }).showIf({ kind: { ne: "hidden" } }) } }).optional(),
  tags: select(["news", "guide"]).many().localized().optional(), meta: json().localized().optional(),
}, { sync: "content/./posts/*.md", agents: true, access: { create: ctx => ctx.data?.locale === "en" && ctx.data.uid !== "reserved" } });
const members = userProjection({ email: email().unique().max(191), name: text().optional() }, { uid: true, access: { read: "self", create: ctx => ctx.data?.uid !== "reserved", update: "self", delete: "admin" } });
export const collections = { authors, posts };
export const tables = { audit };
export const users = { members };
export const entities = { ...collections, ...tables, ...users };
export default defineConfig({
  name: "phase2", collections, tables, users,
  locales: { default: "en", all: ["en", "de"] }, media: { sizes: { thumb: { width: 300, height: 300, fit: "cover" }, wide: { width: 1600 } } },
  files: { decks: files("decks", { accept: ["application/pdf", "image/*"], maxBytes: 20000000, access: { read: "owner", create: ctx => ctx.user !== null, delete: "owner" } }) },
  globals: { settings: global("settings", { title: text().default("Hello") }, { agents: false }) },
  jobs: { sendWelcome: job({ input: { email: email(), data: group({ label: text().default("welcome") }).optional() }, retries: 5, agents: true, handler: async (input, ctx) => { await db.insert(audit).values({ note: input.email + ":" + ctx.jobId + ":" + ctx.attempt }); } }) },
  webhooks: [{ url: env("HOOK_URL"), secret: env("HOOK_SECRET"), events: ["posts.created", "posts.updated", "posts.deleted", "*"] }, { url: "https://example.com/hook", secret: env("OTHER_SECRET"), events: ["members.created"] }],
  actions: { inbound: action({ input: {}, idempotent: true, agents: false, signature: { secret: env("STRIPE_WEBHOOK_SECRET"), header: "stripe-signature", scheme: "hmac-sha256" }, handler: () => true }) },
});

import { jobs, once, type JobCtx, type FieldAccessCtx, type Locale, type LocalizedColumns} from "first";
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
  expectType<Equal<typeof row.locale, Locale>>();
  expectType<Equal<typeof row.translations, LocalizedColumns["translations"]>>();
  expectType<Equal<typeof row.uid, string>>();
  const member = (await db.insert(members).values({ email: "a@example.com", password: "long password" }).returning())[0];
  expectType<Equal<typeof member.role, import("first").Role>>();
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
const field: import("first").FieldRule = ctx => {
  expectType<Equal<typeof ctx, FieldAccessCtx>>();
  return ctx.op === "read" && ctx.data.visible === true;
};
const jobContext = (ctx: JobCtx) => ctx.jobId + ctx.attempt;
void [surface, field, jobContext];
