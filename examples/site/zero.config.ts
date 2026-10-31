// A small publication: authors write posts with rich fields in English and German, readers sign in
// as members and leave comments that editors moderate through an action, and editors keep the site
// settings. tests/system drives a whole user journey through this app on both targets (WordPress and
// standalone).
import {
  collection, global, id, text, integer, boolean, timestamp, richText, media, slug, select,
  repeater, group, blocks, email, url, defineRelations, defineConfig, action, job, jobs, env, file, files, db, HttpError,
} from "zero";

// Who works on the site. Everyone else (anonymous readers, guests, signed-in members) is a reader.
const STAFF = ["author", "editor", "admin"];

export const authors = collection("authors", {
  id: id(),
  name: text().notNull().max(80),
  bio: text({ multiline: true }).max(500),
  avatar: media({ accept: "image" }),
  userId: integer(),                       // the User.id that writes as this author
}, { label: "Authors", title: "name", uid: true, access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const posts = collection("posts", {
  id: id(),
  // Translated per locale. The other fields are shared by a post's translations, except each
  // row's own slug, status and dates.
  title: text().notNull().min(1).max(120).localized(),
  slug: slug({ source: "title" }),
  body: richText().localized(),
  dek: text({ multiline: true }).max(240).localized(),
  cover: media({ accept: "image" }),
  // The author's draft manuscript: a private file, readable by its uploader and the desk.
  manuscript: file({ bucket: "manuscripts" }),
  topics: select({ options: ["culture", "science", "tech"], multiple: true }).notNull().default([]),
  featured: boolean().notNull().default(false),
  // The desk's private notes: staff read and write them; readers' rows never carry the column.
  deskNotes: text({ multiline: true }).max(2000).access({ read: "author", create: "editor", update: "editor" }),
  authorId: integer().references(() => authors.id, { onDelete: "set null" }),
  // The editor shows metaTitle only while the post is indexable (SCF conditional logic).
  seo: group({ fields: { noindex: boolean().notNull().default(false), metaTitle: text().max(70).showIf({ noindex: false }) } }),
  related: repeater({ fields: { label: text().notNull().max(80), href: url().notNull() } }).max(6),
  sections: blocks({ layouts: {
    pullQuote: { text: text({ multiline: true }).notNull(), cite: text().max(80) },
    figure: { image: media({ accept: "image" }).notNull(), caption: text().max(160) },
  } }),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
}, {
  label: "Posts",
  title: "title",
  content: "body",
  // Writers can draft in Markdown in the repo: `zero sync` keeps content/posts/*.md and the site in step.
  sync: "content/posts/*.md",
  access: {
    read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { author: { userId: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
});

export const comments = collection("comments", {
  id: id(),
  postId: integer().notNull().references(() => posts.id, { onDelete: "cascade" }),
  name: text().notNull().max(60),
  body: text({ multiline: true }).notNull().min(1).max(2000),
  approved: boolean().notNull().default(false),
  createdAt: timestamp().notNull().defaultNow(),
}, {
  editor: false,
  // Readers (anonymous, guests, members) see approved comments only; staff see the moderation queue.
  access: { read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { approved: true }, create: "anyone", update: "editor", delete: "editor" },
});

// Newsletter sign-ups from a post. Anyone may sign up; only admins see who did.
export const subscribers = collection("subscribers", {
  id: id(),
  email: email().notNull().unique().max(191),
  postId: integer().references(() => posts.id, { onDelete: "set null" }),
  createdAt: timestamp().notNull().defaultNow(),
}, { editor: false, access: { create: "anyone", read: "admin", update: "admin", delete: "admin" } });

// One row per post announcement the notifyReaders job sent; staff can see what went out.
export const announcements = collection("announcements", {
  id: id(),
  postId: integer().notNull().references(() => posts.id, { onDelete: "cascade" }),
  recipients: integer().notNull(),
  attempt: integer().notNull(),
}, { editor: false, access: { read: "editor", create: "admin", update: "admin", delete: "admin" } });

// Readers who sign in: WordPress users through the zero-identity screens, or a password on
// standalone. Each member sees and edits only their own row.
export const members = collection("members", {
  id: id(),
  email: email().notNull().unique().max(191),
  name: text().notNull().max(80),
  plan: select({ options: ["free", "supporter"] }).notNull().default("free"),
}, { auth: true, access: { read: "self", update: "self", create: "admin", delete: "admin" } });

export const schema = { authors, posts, comments, subscribers, announcements, members };

export const relations = defineRelations(schema, (r) => ({
  posts: {
    author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }),
    comments: r.many.comments(),
    subscribers: r.many.subscribers({ from: r.posts.id, to: r.subscribers.postId }),
  },
  authors: { posts: r.many.posts() },
  comments: { post: r.one.posts({ from: r.comments.postId, to: r.posts.id, optional: false }) },
  subscribers: { post: r.one.posts({ from: r.subscribers.postId, to: r.posts.id }) },
  announcements: { post: r.one.posts({ from: r.announcements.postId, to: r.posts.id }) },
}));

export const settings = global("settings", {
  siteTitle: text().notNull().default("The Zero Review").max(80),
  tagline: text().max(160),
  commentsOpen: boolean().notNull().default(true),
  social: repeater({ fields: { label: text().notNull().max(40), href: url().notNull() } }),
}, { label: "Site settings" });

export default defineConfig({
  name: "site",
  schema,
  relations,
  globals: { settings },
  locales: { default: "en", all: ["en", "de"] },
  // A square `card` crop of every image for listings, centred on the image's focal point.
  media: { sizes: { card: { width: 120, height: 120, fit: "cover" } } },
  // Private: never a public URL; signed 5-minute download links for whoever may read them.
  files: {
    manuscripts: files("manuscripts", {
      accept: ["text/plain", "application/pdf"],
      maxBytes: 1_000_000,
      access: { create: "author", read: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor", delete: "editor" },
    }),
  },
  // Every new comment is POSTed, signed, to the moderation tool at SITE_HOOK_URL (retried on failure).
  webhooks: [{ url: env("SITE_HOOK_URL"), secret: env("SITE_HOOK_SECRET"), events: ["comments.created"] }],
  jobs: {
    // Runs after the publishing request commits, on the queue (Action Scheduler on WordPress).
    notifyReaders: job({
      input: { postId: integer().notNull() },
      retries: 3,
      handler: async ({ postId }, ctx) => {
        const readers = await db.query.subscribers.findMany({ columns: { id: true } });
        await db.insert(announcements).values({ postId, recipients: readers.length, attempt: ctx.attempt });
      },
    }),
  },
  hooks: {
    posts: {
      // Each time a post becomes published (through the API or the editor) readers hear about it;
      // the job key collapses repeats still waiting on the queue. Scheduled posts that the clock
      // publishes run no hooks (both targets), so they announce nothing.
      async afterCreate(row) {
        if (row.status === "published") await jobs.notifyReaders.enqueue({ postId: row.id }, { key: `publish-${row.id}` });
      },
      async afterUpdate(row, previous) {
        if (row.status === "published" && previous.status !== "published") {
          await jobs.notifyReaders.enqueue({ postId: row.id }, { key: `publish-${row.id}` });
        }
      },
      async beforeCreate(data, ctx) {
        if (data.authorId == null && ctx.user) {
          const author = await db.query.authors.findFirst({ where: { userId: ctx.user.id } });
          if (author) data.authorId = author.id;
        }
      },
    },
    comments: {
      // Editors can close comments site-wide; readers can't approve their own; staff skip the queue.
      async beforeCreate(data, ctx) {
        const site = await db.globals.settings.get();
        if (!site.commentsOpen) throw new HttpError(403, "comments_closed", "Comments are closed on this site");
        if (!STAFF.includes(ctx.user?.role ?? "")) data.approved = false;
      },
      async afterCreate(row, ctx) {
        if (STAFF.includes(ctx.user?.role ?? "")) {
          await db.update(comments).set({ approved: true }).where({ id: row.id });
        }
      },
    },
  },
  actions: {
    moderateComment: action({
      input: { id: integer().notNull(), decision: select({ options: ["approve", "reject"] }).notNull() },
      access: "editor",
      async handler({ id, decision }) {
        if (decision === "reject") {
          const [gone] = await db.delete(comments).where({ id }).returning();
          if (!gone) throw new HttpError(404, "not_found", `No comment ${id}`);
          return { id, approved: false, removed: true };
        }
        const [row] = await db.update(comments).set({ approved: true }).where({ id }).returning();
        if (!row) throw new HttpError(404, "not_found", `No comment ${id}`);
        return { id, approved: true, removed: false };
      },
    }),
    frontPage: action({
      input: {},
      access: "anyone",
      async handler() {
        const featured = await db.query.posts.findMany({ where: { status: "published", featured: true }, columns: { id: true } });
        return { featured: featured.map((p) => p.id) };
      },
    }),
  },
});
