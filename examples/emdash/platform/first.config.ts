import {
  action, blocks, boolean, collection, db, defineConfig, defineRelations,
  env, group, integer, job, jobs, json, media, repeater, richText, slug,
  table, text,
} from "first";

const access = { read: "anyone", create: "editor", update: "editor", delete: "editor" };
export const writers = collection({ name: text().notNull() }, { title: "name", uid: true, access });
export const stories = collection({
  title: text().notNull().localized(),
  body: richText().localized(),
  slug: slug({ source: "title" }),
  writerId: integer().references(() => writers.id, { onDelete: "set null" }),
  cover: media({ accept: "image" }),
  price: integer(),
  editorNote: text().access({ read: "editor", create: "editor", update: "editor" }),
  details: group({ fields: { subtitle: text(), featured: boolean().default(false) } }),
  links: repeater({ fields: { label: text().notNull(), href: text().notNull() } }),
  sections: blocks({ layouts: {
    quote: { text: text().notNull(), cite: text() },
    callout: { heading: text().notNull(), body: text() },
  } }),
  metadata: json(),
}, { title: "title", content: "body", drafts: true, revisions: true, access });
export const tasks = table({
  label: text().notNull(),
  storyId: integer().references(() => stories.id, { onDelete: "cascade" }),
  processed: boolean().notNull().default(false),
}, { access });
export const guides = collection({ title: text().notNull(), body: richText(), slug: slug({ source: "title" }) }, {
  title: "title", content: "body", sync: "content/guides/*.md", drafts: true, revisions: true, access,
});
export const deliveries = table({ message: text().notNull() }, { access: { read: "editor" } });

const relations = defineRelations({ stories, writers, tasks }, (r) => ({
  stories: { writer: r.one.writers({ from: r.stories.writerId, to: r.writers.id }), tasks: r.many.tasks() },
  writers: { stories: r.many.stories() },
  tasks: { story: r.one.stories({ from: r.tasks.storyId, to: r.stories.id }) },
}));

export default defineConfig({
  name: "platform", admin: true,
  collections: { stories, writers, guides }, tables: { tasks, deliveries }, relations,
  locales: { default: "en", all: ["en", "fr"] },
  media: { sizes: { card: { width: 120, height: 120, fit: "cover" }, wide: { width: 200 } } },
  hooks: { tasks: {
    beforeCreate(data) { data.label = data.label.trim(); },
    async afterCreate(row) { await jobs.processTask.enqueue({ taskId: row.id }); },
  } },
  jobs: { processTask: job({ input: { taskId: integer().notNull() }, handler: async ({ taskId }) => {
    await db.update(tasks).set({ processed: true }).where({ id: taskId });
  } }) },
  webhooks: [{ url: env("PLATFORM_HOOK_URL"), secret: env("PLATFORM_HOOK_SECRET"), events: ["tasks.created"] }],
  actions: { receive: action({
    input: { message: text().notNull() },
    signature: { secret: env("PLATFORM_HOOK_SECRET"), header: "first-signature", scheme: "hmac-sha256" },
    handler: async ({ message }) => { await db.insert(deliveries).values({ message }); return { received: message }; },
  }) },
});
