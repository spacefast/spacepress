import { collection, defineConfig, global, job, table, query, mutation, f } from "spacepress";
import { HttpError } from "spacepress/server";

export const articles = collection({
  title: f.text().min(1).max(120),
  body: f.richText().optional(),
  internalNote: f.text().access({ read: "editor", create: "editor", update: "editor" }).optional(),
  reviewed: f.boolean().default(false),
}, {
  title: "title",
  content: "body",
  access: {
    read: (ctx) => ["editor", "admin"].includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "editor", update: "editor", delete: "editor",
  },
});

export const privateNotes = table({ note: f.text() }, {
  agents: false,
  access: { read: "admin", create: "admin", update: "admin", delete: "admin" },
});

export const settings = global({
  heading: f.text().default("The agent notebook"),
  description: f.text().default("Written by people and their tools. Published only when ready."),
});

export const privateSettings = global({
  note: f.text().default("Operator notes"),
}, { agents: false, access: { read: "admin", update: "admin" } });

// Adapted from EmDash's MIT-licensed mcp-smoke example; see UPSTREAM.md and LICENSE.emdash.
export const echo = query({ access: "subscriber" }, (_ctx, { message }: { message: string }) => { if (message.length < 1) throw new HttpError(422, "invalid_input", "message must be at least 1 character", "/message"); if (message.length > 200) throw new HttpError(422, "invalid_input", "message must be at most 200 characters", "/message"); return ({ message, length: message.length }); });

export const publishArticle = mutation({ access: "editor" }, async ({ db }, { id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const article = await db.articles.update(id, { status: "published" });
  if (!article) throw new HttpError(404, "not_found", "Article not found");
  return article;
});

export const operatorNote = query({ agents: false, access: "admin" }, (_ctx, { note }: { note: string }) => ({ note }));

export const review = job({ agents: true }, async ({ db }, { articleId }: { articleId: number }) => {
  if (!Number.isInteger(articleId)) throw new HttpError(422, "invalid_input", "articleId must be an integer", "/articleId");
  await db.articles.update(articleId, { reviewed: true });
});

// Jobs are unavailable to agents unless explicitly enabled.
export const internalSweep = job({}, () => {});

export default defineConfig({
  name: "agents",
});
