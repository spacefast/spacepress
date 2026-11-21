import { boolean, collection, db, defineConfig, global, HttpError, job, richText, table, text, query, mutation } from "typedpress";

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

// Adapted from EmDash's MIT-licensed mcp-smoke example; see UPSTREAM.md and LICENSE.emdash.
export const echo = query({ access: "subscriber" }, ({ message }: { message: string }) => { if (message.length < 1) throw new HttpError(422, "invalid_input", "message must be at least 1 character", "/message"); if (message.length > 200) throw new HttpError(422, "invalid_input", "message must be at most 200 characters", "/message"); return ({ message, length: message.length }); });

export const publishArticle = mutation({ access: "editor" }, async ({ id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const [article] = await db.update(articles).set({ status: "published" }).where({ id }).returning();
  if (!article) throw new HttpError(404, "not_found", "Article not found");
  return article;
});

export const operatorNote = query({ agents: false, access: "admin" }, ({ note }: { note: string }) => ({ note }));

export const review = job({ agents: true }, async ({ articleId }: { articleId: number }) => {
  if (!Number.isInteger(articleId)) throw new HttpError(422, "invalid_input", "articleId must be an integer", "/articleId");
  await db.update(articles).set({ reviewed: true }).where({ id: articleId });
});

// Jobs are unavailable to agents unless explicitly enabled.
export const internalSweep = job({}, () => {});

export default defineConfig({
  name: "agents",
});
