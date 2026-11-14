import { action, boolean, collection, db, defineConfig, global, HttpError, integer, job, richText, table, text } from "first";

export const articles = collection({
  title: text().min(1).max(120),
  body: richText().optional(),
  internalNote: text().access({ read: "editor", create: "editor", update: "editor" }).optional(),
  reviewed: boolean().default(false),
}, {
  title: "title",
  content: "body",
  access: {
    read: (ctx) => ["editor", "admin"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "editor", update: "editor", delete: "editor",
  },
});

export const privateNotes = table({ note: text() }, {
  agents: false,
  access: { read: "admin", create: "admin", update: "admin", delete: "admin" },
});

export const settings = global({
  heading: text().default("The agent notebook"),
  description: text().default("Written by people and their tools. Published only when ready."),
});

export const privateSettings = global({
  note: text().default("Operator notes"),
}, { agents: false, access: { read: "admin", update: "admin" } });

export default defineConfig({
  name: "agents",
  collections: { articles },
  tables: { privateNotes },
  globals: { settings, privateSettings },
  actions: {
    // Adapted from EmDash's MIT-licensed mcp-smoke example; see UPSTREAM.md and LICENSE.emdash.
    echo: action({
      input: { message: text().min(1).max(200) },
      access: "subscriber",
      handler: ({ message }) => ({ message, length: message.length }),
    }),
    publishArticle: action({
      input: { id: integer() },
      access: "editor",
      async handler({ id }) {
        const [article] = await db.update(articles).set({ status: "published" }).where({ id }).returning();
        if (!article) throw new HttpError(404, "not_found", "Article not found");
        return article;
      },
    }),
    operatorNote: action({
      input: { note: text() },
      agents: false,
      access: "admin",
      handler: ({ note }) => ({ note }),
    }),
  },
  jobs: {
    review: job({
      input: { articleId: integer() },
      agents: true,
      async handler({ articleId }) {
        await db.update(articles).set({ reviewed: true }).where({ id: articleId });
      },
    }),
    // Jobs are unavailable to agents unless explicitly enabled.
    internalSweep: job({ input: {}, handler() {} }),
  },
});
