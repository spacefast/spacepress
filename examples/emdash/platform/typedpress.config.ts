import {
  action, blocks, boolean, collection, db, defineConfig, env, group, integer, job, jobs, json, media, repeater, richText, slug,
  table, text, ref,
} from "typedpress";

const access = { read: "anyone", create: "editor", update: "editor", delete: "editor" };
export const writers = collection({ name: text() }, { title: "name", uid: true, access });
export const stories = collection({
  title: text(),
  body: richText().optional(),
  slug: slug({ source: "title" }).optional(),
  writerId: ref(writers).optional(),
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
  storyId: ref(stories).optional().onDelete("cascade"),
  processed: boolean().default(false),
}, { access }).on({
  beforeCreate(data) { data.label = data.label.trim(); },
  async afterCreate(row) { await jobs.processTask.enqueue({ taskId: row.id }); },
});
export const guides = collection({ title: text(), body: richText().optional(), slug: slug({ source: "title" }).optional() }, {
  title: "title", content: "body", sync: "content/guides/*.md", drafts: true, revisions: true, access,
});
export const deliveries = table({ message: text() }, { access: { read: "editor" } });

export const processTask = job({ input: { taskId: integer() }, handler: async ({ taskId }) => {
  await db.update(tasks).set({ processed: true }).where({ id: taskId });
} });

export const receive = action({
  input: { message: text() },
  signature: { secret: env("PLATFORM_HOOK_SECRET"), header: "typedpress-signature", scheme: "hmac-sha256" },
  handler: async ({ message }) => { await db.insert(deliveries).values({ message }); return { received: message }; },
});

export default defineConfig({
  name: "platform",
  media: { sizes: { card: { width: 120, height: 120, fit: "cover" }, wide: { width: 200 } } },
  webhooks: [{ url: env("PLATFORM_HOOK_URL"), secret: env("PLATFORM_HOOK_SECRET"), events: ["tasks.created"] }],
});
