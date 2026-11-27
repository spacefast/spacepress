import { collection, extend, global, table, query, mutation, f } from "spacepress";
import { HttpError } from "spacepress/server";

export const authors = collection({
  name: f.text().max(80),
  // Editors only: absent from a reader's rows.
  email: f.email().unique().max(191).access({ read: "editor" }).optional(),
}, { title: "name", sync: "content/authors/*.json", access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

export const notes = collection({
  title: f.text().min(1).max(120),
  slug: f.slug({ source: "title" }).optional(),
  body: f.richText().optional(),
  rating: f.number().min(0).max(5).optional(),
  pinned: f.boolean().default(false),
  due: f.date().optional(),
  remindAt: f.timestamp().optional(),
  link: f.url().optional(),
  kind: f.select(["memo", "todo"]).default("memo"),
  tags: f.select(["home", "work"]).many().default([]),
  cover: f.media({ accept: "image" }).optional(),
  // A ref is the author's id, and the author row once `with` asks for it.
  author: f.ref(authors).optional(),
  seo: f.group({ heading: f.text().max(70).optional(), hidden: f.boolean().default(false) }).optional(),
  steps: f.repeater({ label: f.text().max(40), done: f.boolean().default(false) }).max(5).optional(),
  sections: f.blocks({ quote: { text: f.text(), cite: f.text().optional() }, rule: {} }).optional(),
  extra: f.json<{ source: string }>().optional(),
}, { title: "title", content: "body", drafts: true, revisions: true, comments: true, access: { read: "anyone", create: "author", update: "editor", delete: "editor" } });

// A table readers add to; rows are never deleted over the API.
export const tallies = table({
  label: f.text().max(40),
  count: f.integer().default(0).min(0),
}, { access: { read: "anyone", create: "anyone", update: "editor", delete: "admin" }, api: { delete: false } });

export const members = extend("users", {
  fields: {
    name: f.text().max(80),
    plan: f.select(["free", "pro"]).default("free"),
  },
  // A member reads their own row; admins read every row (a coded rule, so the document says "rule").
  access: { read: (ctx) => ctx.user?.role === "admin" ? true : { id: ctx.user?.id ?? -1 }, update: "self", create: "admin", delete: "admin" },
});

export const site = global({
  motto: f.text().default("Write it down").max(80),
  perPage: f.integer().default(10).min(1).max(50),
}, { label: "Site options" });

export const greet = mutation({ access: "anyone" }, (_ctx, { who, times }: { who: string; times?: number }) => { if (who.length > 40) throw new HttpError(422, "invalid_input", "who must be at most 40 characters", "/who"); if (times !== undefined && times < 1) throw new HttpError(422, "invalid_input", "times must be at least 1", "/times"); if (times !== undefined && times > 3) throw new HttpError(422, "invalid_input", "times must be at most 3", "/times"); return ({ greeting: `Hello, ${who}`, times: times ?? 1, loud: false }); });

export const tallyCount = query({ access: "anyone" }, () => [1, 2, 3].length);

export const stamp = mutation({ idempotent: true }, (_ctx, { label }: { label: string }) => [label, 1] as [string, number]);
