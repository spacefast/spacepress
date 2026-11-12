import {
  action, blocks, boolean, collection, db, defineConfig, defineRelations,
  env, group, integer, job, jobs, json, media, repeater, richText, slug,
  table, text,
} from "first";

const access = { read: "anyone", create: "editor", update: "editor", delete: "editor" };
export const writers = collection({ name: text() }, { title: "name", uid: true, access });
export const stories = collection({
  title: text().localized(),
  body: richText().localized().optional(),
  slug: slug({ source: "title" }).optional(),
  writerId: integer().references(() => writers.id, { onDelete: "set null" }).optional(),
  cover: media({ accept: "image" }).optional(),
  price: integer().optional(),
  editorNote: text().access({ read: "editor", create: "editor", update: "editor" }).optional(),
  details: group({ subtitle: text().optional(), featured: boolean().default(false).optional() }).optional(),
  links: repeater({ label: text(), href: text() }).optional(),
  sections: blocks({
    quote: { text: text(), cite: text().optional() },
    callout: { heading: text(), body: text().optional() },
  }).optional(),
  metadata: json().optional(),
}, { title: "title", content: "body", drafts: true, revisions: true, access });
export const tasks = table({
  label: text(),
  storyId: integer().references(() => stories.id, { onDelete: "cascade" }).optional(),
  processed: boolean().default(false),
}, { access });
export const guides = collection({ title: text(), body: richText().optional(), slug: slug({ source: "title" }).optional() }, {
  title: "title", content: "body", sync: "content/guides/*.md", drafts: true, revisions: true, access,
});
export const deliveries = table({ message: text() }, { access: { read: "editor" } });

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
  jobs: { processTask: job({ input: { taskId: integer() }, handler: async ({ taskId }) => {
    await db.update(tasks).set({ processed: true }).where({ id: taskId });
  } }) },
  webhooks: [{ url: env("PLATFORM_HOOK_URL"), secret: env("PLATFORM_HOOK_SECRET"), events: ["tasks.created"] }],
  actions: { receive: action({
    input: { message: text() },
    signature: { secret: env("PLATFORM_HOOK_SECRET"), header: "first-signature", scheme: "hmac-sha256" },
    handler: async ({ message }) => { await db.insert(deliveries).values({ message }); return { received: message }; },
  }) },
});
