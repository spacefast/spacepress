import { collection, defineConfig, env, job, table, mutation, f } from "spacepress";
import { HttpError } from "spacepress/server";

const access = { read: "anyone", create: "editor", update: "editor", delete: "editor" };
export const writers = collection({ name: f.text() }, { title: "name", uid: true, access });
export const stories = collection({
  title: f.text(),
  body: f.richText().optional(),
  slug: f.slug({ source: "title" }).optional(),
  writerId: f.ref(writers).optional(),
  cover: f.media({ accept: "image" }).optional(),
  price: f.integer().optional(),
  editorNote: f.text().access({ read: "editor", create: "editor", update: "editor" }).optional(),
  details: f.group({ subtitle: f.text().optional(), featured: f.boolean().default(false).optional() }).optional(),
  links: f.repeater({ label: f.text(), href: f.text() }).optional(),
  sections: f.blocks({
    quote: { text: f.text(), cite: f.text().optional() },
    callout: { heading: f.text(), body: f.text().optional() },
  }).optional(),
  metadata: f.json().optional(),
}, { title: "title", content: "body", drafts: true, revisions: true, access });
export const tasks = table({
  label: f.text(),
  storyId: f.ref(stories).optional().onDelete("cascade"),
  processed: f.boolean().default(false),
}, { access }).on({
  beforeCreate({ data }) { data.label = data.label.trim(); },
  async afterCreate({ row }) { await processTask.enqueue({ taskId: row.id }); },
});
export const guides = collection({ title: f.text(), body: f.richText().optional(), slug: f.slug({ source: "title" }).optional() }, {
  title: "title", content: "body", sync: "content/guides/*.md", drafts: true, revisions: true, access,
});
export const deliveries = table({ message: f.text() }, { access: { read: "editor" } });

export const processTask = job({}, async ({ db }, { taskId }: { taskId: number }) => {
  if (!Number.isInteger(taskId)) throw new HttpError(422, "invalid_input", "taskId must be an integer", "/taskId");
  await db.tasks.update(taskId, { processed: true });
});

export const receive = mutation({ signature: { secret: env("PLATFORM_HOOK_SECRET"), header: "spacepress-signature", scheme: "hmac-sha256" } }, async ({ db }, { message }: { message: string }) => { await db.deliveries.create({ message }); return { received: message }; });

export default defineConfig({
  name: "platform",
  media: { sizes: { card: { width: 120, height: 120, fit: "cover" }, wide: { width: 200 } } },
  webhooks: [{ url: env("PLATFORM_HOOK_URL"), secret: env("PLATFORM_HOOK_SECRET"), events: ["tasks.created"] }],
});
