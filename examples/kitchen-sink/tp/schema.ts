import {
  blocks, boolean, collection, date, email, file, files, global, HttpError, integer, json,
  media, number, ref, repeater, richText, select, slug, table, taxonomy, terms, text, timestamp,
  url, userProjection, wp, group, jobs,
} from "typedpress";

export const topics = taxonomy({ color: text().pattern(/^#[0-9a-f]{6}$/).optional() });
export const handouts = files({
  accept: ["application/pdf"], maxBytes: 5_000_000,
  access: { read: "authenticated", create: "editor", delete: "admin" },
});

export const events = collection({
  title: text().min(1).max(120).ui({ label: "Workshop title" }),
  slug: slug({ source: "title" }).optional(),
  description: richText().optional(),
  startsOn: date(),
  venue: text().default("Teaching kitchen"),
  poster: media({ accept: "image" }).optional(),
  gallery: media({ accept: "image" }).many().default([]),
  handout: file(handouts).optional(),
  format: select(["class", "demo"]).default("class"),
  equipment: select(["apron", "knife", "scale"]).many().default([]),
  registrationOpen: boolean().default(true),
  demoUrl: url().optional().showIf({ format: "demo" }),
  ingredients: repeater({ name: text(), grams: number().min(0) }).optional(),
  host: group({ name: text(), website: url().optional() }).optional(),
  sections: blocks({
    tip: { heading: text(), body: richText() },
    quote: { text: text({ multiline: true }), author: text() },
  }).optional(),
}, {
  label: "Workshops", title: "title", content: "description", comments: true,
  sync: "content/events/*.md", url: "/events/:slug",
  access: { read: "anyone", create: "editor", update: "editor", delete: "admin" },
}).on({
  beforeCreate(data) {
    data.title = data.title.trim();
    if (data.title === "") throw new HttpError(422, "invalid_input", "Enter a workshop title.");
  },
  async afterCreate(event) {
    await jobs.recordEvent.enqueue({ eventId: event.id }, { key: `event-${event.id}` });
  },
});

export const posts = wp.posts.extend({
  minutes: integer().min(1).optional().ui({ label: "Reading time" }),
}, { url: "/journal/:slug", sync: "content/posts/*.md" });

export const recipes = wp.posts.clone({
  servings: integer().min(1).default(4),
  topicIds: terms(topics).reverse("recipes"),
}, { label: "Recipes" });

export const handbook = collection({
  title: text(),
  slug: slug({ source: "title" }),
  content: richText().optional(),
}, { hierarchical: true, url: "/handbook/:path", sync: "content/handbook/**/*.md" });

export const members = userProjection({
  email: email().unique().max(191),
  name: text().max(80),
  website: url().optional(),
  plan: select(["free", "supporter"]).default("free"),
}, { access: { read: "self", create: "admin", update: "self", delete: "admin" } });

export const registrations = table({
  eventId: ref(events).onDelete("restrict").reverse("registrations"),
  memberId: ref(members).onDelete("restrict"),
  seats: integer().min(1).max(4).default(1).validate((value) => value % 1 === 0 ? true : "Enter a whole number of seats."),
  code: text().max(36).unique().$default(() => crypto.randomUUID()),
  preferences: json<{ allergens: string[] }>().optional().access({ read: "admin" }),
  bookedOn: date().defaultNow(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()),
}, { access: { read: "editor", create: "admin", update: "editor", delete: "admin" } })
  .index(["eventId", "memberId"], { unique: true });

export const activity = table({
  eventId: ref(events).onDelete("restrict"),
  summary: text().was("message"),
  reference: text().max(36).$defaultFn(() => crypto.randomUUID()),
  updatedAt: timestamp().defaultNow().$onUpdateFn(() => new Date()),
  createdAt: timestamp().defaultNow(),
}, { agents: false, access: { read: "editor", create: "admin", update: "admin", delete: "admin" } });

export const settings = global({
  siteTitle: text().default("Community Kitchen"),
  announcement: text({ multiline: true }).optional(),
  replyTo: email().optional(),
  links: repeater({ label: text(), href: url() }).optional(),
}, { label: "Kitchen settings", access: { read: "anyone", update: "admin" } });
