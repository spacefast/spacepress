import { collection, extend, f, files, global, job, table, taxonomy } from "spacepress";
import { HttpError } from "spacepress/server";
import { delete_option, update_option } from "spacepress/server/wp";

// Queued by the workshops' afterCreate hook, run by Action Scheduler after the request commits.
export const recordEvent = job({ retries: 3 }, async ({ db, once, jobId }, { eventId }: { eventId: number }) => {
  if (!Number.isInteger(eventId)) throw new HttpError(422, "invalid_input", "eventId must be an integer", "/eventId");
  // A retried run writes the option once.
  await once(jobId, () => update_option("kitchen_has_workshops", true));
  await db.activity.create({ eventId, summary: "Workshop created" });
});

export const topics = taxonomy(
  { color: f.text().pattern(/^#[0-9a-f]{6}$/).optional() },
  { label: "Topics", sync: "content/topics/*.md" },
);
export const handouts = files({
  accept: ["application/pdf"], maxBytes: 5_000_000,
  access: { read: "authenticated", create: "editor", delete: "admin" },
});

export const events = collection({
  title: f.text().min(1).max(120).ui({ label: "Workshop title" }),
  slug: f.slug({ source: "title" }).optional(),
  description: f.richText().optional(),
  startsOn: f.date(),
  venue: f.text().default("Teaching kitchen").searchable(false),
  poster: f.media({ accept: "image" }).optional(),
  gallery: f.media({ accept: "image" }).many().default([]),
  handout: f.file(handouts).optional(),
  format: f.select(["class", "demo"]).default("class"),
  equipment: f.select(["apron", "knife", "scale"]).many().default([]),
  registrationOpen: f.boolean().default(true),
  demoUrl: f.url().optional().showIf({ format: "demo" })
    .validate((link) => link.startsWith("https://") ? true : "Link to the demo over https."),
  ingredients: f.repeater({ name: f.text(), grams: f.number().min(0) }).optional(),
  host: f.group({ name: f.text(), website: f.url().optional() }).optional(),
  sections: f.blocks({
    tip: { heading: f.text(), body: f.richText() },
    quote: { text: f.text({ multiline: true }), author: f.text() },
  }).optional(),
}, {
  label: "Workshops", title: "title", content: "description", comments: true,
  sync: "content/events/*.md",
  access: { read: "anyone", create: "editor", update: "editor", delete: "admin", restore: "admin", purge: "admin" },
}).on({
  beforeCreate({ data }) {
    data.title = data.title.trim();
    if (data.title === "") throw new HttpError(422, "invalid_input", "Enter a workshop title.");
  },
  async afterCreate({ row: event }): Promise<void> {
    await recordEvent.enqueue({ eventId: event.id }, { key: `event-${event.id}` });
  },
  beforeUpdate({ patch, existing }) {
    if (patch.registrationOpen === true && existing.startsOn < new Date().toISOString().slice(0, 10)) {
      throw new HttpError(409, "workshop_over", "Registration can't reopen after the workshop date.");
    }
  },
  async afterUpdate({ row: event, previous, db }): Promise<void> {
    if (previous.registrationOpen && !event.registrationOpen) {
      await db.system.activity.create({ eventId: event.id, summary: "Registration closed" });
    }
  },
  async onPublish({ row: event, db }): Promise<void> {
    await db.system.activity.create({ eventId: event.id, summary: "Workshop published" });
  },
  async beforeDelete({ row: event, db }): Promise<void> {
    const booked = await db.system.registrations.get({ eventId: event.id });
    if (booked) throw new HttpError(409, "has_registrations", "Cancel this workshop's reservations before deleting it.");
  },
  async afterDelete({ row: event, db }): Promise<void> {
    await db.system.activity.create({ summary: `Workshop deleted: ${event.title}` });
    const remaining = await db.system.events.list({ columns: { id: true }, limit: 1 });
    if (remaining.length === 0) delete_option("kitchen_has_workshops");
  },
  beforeRestore({ row: event }): void {
    if (event.title.trim() === "") throw new HttpError(409, "invalid_workshop", "Cannot restore an untitled workshop.");
  },
  async afterRestore({ row: event, db }): Promise<void> {
    await db.system.activity.create({ eventId: event.id, summary: `Workshop restored: ${event.title}` });
  },
  async beforePurge({ row: event, db }): Promise<void> {
    const booked = await db.system.registrations.get({ eventId: event.id });
    if (booked) throw new HttpError(409, "has_registrations", "Cannot purge a workshop that still has reservations.");
  },
  async afterPurge({ row: event, db }): Promise<void> {
    await db.system.activity.create({ summary: `Workshop purged: ${event.title}` });
  },
});

export const posts = extend("posts", {
  fields: {
    minutes: f.integer().min(1).optional().ui({ label: "Reading time" }),
  },
  sync: "content/posts/*.md",
});

export const recipes = collection({
  title: f.text().min(1),
  slug: f.slug({ source: "title" }).optional(),
  content: f.richText().optional(),
  excerpt: f.text({ multiline: true }).optional(),
  servings: f.integer().min(1).default(4),
  topicIds: f.terms(topics).reverse("recipes"),
}, {
  label: "Recipes", title: "title", content: "content", comments: true, sync: "content/recipes/*.md",
  access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
});

export const handbook = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }),
  content: f.richText().optional(),
}, { hierarchical: true, sync: "content/handbook/**/*.md" });

export const members = extend("users", {
  fields: {
    website: f.url().optional(),
    plan: f.select(["free", "supporter"]).default("free"),
  },
  access: { read: "self", create: "admin", update: "self", delete: "admin" },
});

export const registrations = table({
  eventId: f.ref(events).onDelete("restrict").reverse("registrations"),
  memberId: f.ref(members).onDelete("restrict"),
  seats: f.integer().min(1).max(4).default(1),
  code: f.text().max(36).unique().default(() => crypto.randomUUID()),
  preferences: f.json<{ allergens: string[] }>().optional().access({ read: "admin" }),
  bookedOn: f.date().defaultNow(),
  updatedAt: f.timestamp().defaultNow().onUpdate(() => new Date()),
}, {
  access: {
    read: (ctx) => ctx.user?.role === "editor" || ctx.user?.role === "admin" ? true : { memberId: ctx.user?.id ?? 0 },
    create: "admin", update: "editor", delete: "admin",
  },
}).index(["eventId", "memberId"], { unique: true });

export const activity = table({
  eventId: f.ref(events).optional(),
  summary: f.text().column("message").alias("message"),
  createdAt: f.timestamp().defaultNow(),
}, { agents: false, access: { read: "editor", create: "admin", update: "admin", delete: "admin" } });

export const settings = global({
  siteTitle: f.text().default("Community Kitchen"),
  announcement: f.text({ multiline: true }).optional(),
  mailFrom: f.email().optional(),
  replyTo: f.email().optional(),
  links: f.repeater({ label: f.text(), href: f.url() }).optional(),
}, { label: "Kitchen settings", access: { read: "anyone", update: "admin" } });
