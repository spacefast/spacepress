import { blocks, boolean, collection, date, email, global, group, integer, json, media, number, ref, repeater, richText, select, slug, table, text, timestamp, url, userProjection, query, mutation } from "spacepress";
import { HttpError } from "spacepress/server";

export const authors = collection({
  name: text().max(80),
  // Editors only: absent from a reader's rows.
  email: email().unique().max(191).access({ read: "editor" }).optional(),
}, { title: "name", sync: "content/authors/*.json", access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } });

export const notes = collection({
  title: text().min(1).max(120),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
  rating: number().min(0).max(5).optional(),
  pinned: boolean().default(false),
  due: date().optional(),
  remindAt: timestamp().optional(),
  link: url().optional(),
  kind: select(["memo", "todo"]).default("memo"),
  tags: select(["home", "work"]).many().default([]),
  cover: media({ accept: "image" }).optional(),
  // A ref is the author's id, and the author row once `with` asks for it.
  author: ref(authors).optional(),
  seo: group({ heading: text().max(70).optional(), hidden: boolean().default(false) }).optional(),
  steps: repeater({ label: text().max(40), done: boolean().default(false) }).max(5).optional(),
  sections: blocks({ quote: { text: text(), cite: text().optional() }, rule: {} }).optional(),
  extra: json<{ source: string }>().optional(),
}, { title: "title", content: "body", drafts: true, revisions: true, comments: true, access: { read: "anyone", create: "author", update: "editor", delete: "editor" } });

// A table readers add to; rows are never deleted over the API.
export const tallies = table({
  label: text().max(40),
  count: integer().default(0).min(0),
}, { access: { read: "anyone", create: "anyone", update: "editor", delete: "admin" }, api: { delete: false } });

export const members = userProjection({
  email: email().unique().max(191),
  name: text().max(80),
  plan: select(["free", "pro"]).default("free"),
}, {
  // A member reads their own row; admins read every row (a coded rule, so the document says "rule").
  access: { read: (ctx) => ctx.user?.role === "admin" ? true : { id: ctx.user?.id ?? -1 }, update: "self", create: "admin", delete: "admin" },
});

export const site = global({
  motto: text().default("Write it down").max(80),
  perPage: integer().default(10).min(1).max(50),
}, { label: "Site options" });

export const greet = mutation({ access: "anyone" }, ({ who, times }: { who: string; times?: number }) => { if (who.length > 40) throw new HttpError(422, "invalid_input", "who must be at most 40 characters", "/who"); if (times !== undefined && times < 1) throw new HttpError(422, "invalid_input", "times must be at least 1", "/times"); if (times !== undefined && times > 3) throw new HttpError(422, "invalid_input", "times must be at most 3", "/times"); return ({ greeting: `Hello, ${who}`, times: times ?? 1, loud: false }); });

export const tallyCount = query({ access: "anyone" }, () => [1, 2, 3].length);

export const stamp = mutation({ idempotent: true }, ({ label }: { label: string }) => [label, 1] as [string, number]);
