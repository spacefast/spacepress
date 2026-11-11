import {
  action, blocks, boolean, collection, date, db, defineConfig, defineRelations,
  email, env, file, files, global, group, HttpError, integer, job, jobs, media,
  repeater, richText, select, slug, table, text, timestamp, url, userProjection,
} from "first";

// Native WordPress posts: title, content, drafts, revisions and custom fields.
export const pages = collection({
  title: text().notNull().max(120).localized(),
  slug: slug({ source: "title" }),
  body: richText().localized(),
  cover: media({ accept: "image" }),
  featured: boolean().notNull().default(false),
  seo: group({ fields: {
    title: text().max(70),
    description: text({ multiline: true }).max(160),
  } }),
  sections: blocks({ layouts: {
    hero: { heading: text().notNull(), image: media({ accept: "image" }) },
    quote: { text: text({ multiline: true }).notNull(), author: text() },
  } }),
}, {
  label: "Pages", title: "title", content: "body", uid: true,
  access: {
    read: (ctx) => ["editor", "admin"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "editor", update: "editor", delete: "admin",
  },
});

export const events = collection({
  title: text().notNull().max(120),
  slug: slug({ source: "title" }),
  description: richText(),
  startsOn: date().notNull(),
  venue: text().notNull(),
  poster: media({ accept: "image" }),
  handout: file({ bucket: "handouts" }),
  speakers: repeater({ fields: { name: text().notNull(), bio: text({ multiline: true }) } }),
}, { label: "Events", title: "title", content: "description" });

// WordPress users with additional profile fields and access to their own row.
export const members = userProjection({
  email: email().notNull().unique().max(191),
  name: text().notNull().max(80),
  website: url(),
  plan: select({ options: ["free", "supporter"] }).notNull().default("free"),
}, { access: { read: "self", create: "anyone", update: "self", delete: "admin" } });

// App data in custom tables, related to native posts and users.
export const registrations = table({
  eventId: integer().notNull().references(() => events.id, { onDelete: "cascade" }),
  memberId: integer().notNull().references(() => members.id, { onDelete: "cascade" }),
  confirmed: boolean().notNull().default(false),
  createdAt: timestamp().notNull().defaultNow(),
}, { access: { read: "editor", create: "authenticated", update: "editor", delete: "admin" } });

export const activity = table({
  pageId: integer().notNull().references(() => pages.id, { onDelete: "cascade" }),
  message: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
}, { access: { read: "editor", create: "admin", update: "admin", delete: "admin" } });

const entities = { pages, events, members, registrations, activity };
const relations = defineRelations(entities, (r) => ({
  events: { registrations: r.many.registrations() },
  members: { registrations: r.many.registrations() },
  registrations: {
    event: r.one.events({ from: r.registrations.eventId, to: r.events.id, optional: false }),
    member: r.one.members({ from: r.registrations.memberId, to: r.members.id, optional: false }),
  },
  pages: { activity: r.many.activity() },
  activity: { page: r.one.pages({ from: r.activity.pageId, to: r.pages.id, optional: false }) },
}));

// Shared settings use WordPress options through Secure Custom Fields.
export const settings = global("settings", {
  siteTitle: text().notNull().default("The kitchen sink"),
  contactEmail: email(),
  announcement: text({ multiline: true }),
  links: repeater({ fields: { label: text().notNull(), href: url().notNull() } }),
}, { label: "Site settings", access: { read: "anyone", update: "admin" } });

export default defineConfig({
  name: "kitchen-sink",
  admin: true,
  collections: { pages, events },
  tables: { registrations, activity },
  users: { members },
  globals: { settings },
  relations,
  locales: { default: "en", all: ["en", "de"] },
  media: { sizes: { card: { width: 600, height: 400, fit: "cover" }, avatar: { width: 96, height: 96, fit: "cover" } } },
  files: { handouts: files("handouts", { accept: ["application/pdf"], maxBytes: 5_000_000, access: { read: "authenticated", create: "editor", delete: "admin" } }) },
  plugins: { "classic-editor": "1.6.7" },
  webhooks: [{ url: env("KITCHEN_WEBHOOK_URL"), secret: env("KITCHEN_WEBHOOK_SECRET"), events: ["pages.created", "pages.updated"] }],
  hooks: {
    pages: {
      beforeCreate(data) {
        data.title = data.title.trim();
        if (data.title === "") throw new HttpError(422, "invalid_input", "Give this page a title");
      },
      async afterCreate(page) {
        await jobs.recordPage.enqueue({ pageId: page.id }, { key: `page-${page.id}` });
      },
    },
  },
  jobs: {
    recordPage: job({
      input: { pageId: integer().notNull() }, retries: 3,
      async handler({ pageId }) {
        await db.insert(activity).values({ pageId, message: "Page created" });
      },
    }),
  },
  actions: {
    publishPage: action({
      input: { title: text().notNull(), body: text().notNull() }, access: "editor",
      async handler({ title, body }) {
        const [page] = await db.insert(pages).values({ title, body, status: "published" }).returning();
        return page;
      },
    }),
    renameMember: action({
      input: { id: integer().notNull(), name: text().notNull() }, access: "admin",
      async handler({ id, name }) {
        const [member] = await db.update(members).set({ name }).where({ id }).returning();
        if (!member) throw new HttpError(404, "not_found", "Member not found");
        return member;
      },
    }),
  },
});
