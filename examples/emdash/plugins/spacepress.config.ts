import { boolean, collection, defineConfig, group, integer, json, repeater, richText, table, text, select, query, mutation } from "spacepress";
import { db, HttpError } from "spacepress/server";

// The four field-kit data shapes become native Secure Custom Fields controls.
export const entries = collection({
  title: text().min(1).max(160),
  body: richText().optional(),
  profile: group({ name: text().optional(), featured: boolean().optional() }).optional(),
  ingredients: repeater({ name: text(), quantity: integer().min(0).optional() }).optional(),
  grid: repeater({ monday: text().optional(), tuesday: text().optional() }).optional(),
  tags: json().optional(),
  palette: text().pattern(/^#[0-9a-fA-F]{6}$/).default("#375c48").optional(),
  embeds: json().optional(),
}, {
  title: "title", content: "body", label: "Plugin stories", comments: true,
  access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
}).on({ beforeCreate(data) { data.title = data.title.trim(); } });

export const records = table({
  externalId: text().max(120).unique(),
  state: select(["pending", "processing", "done"]).default("pending"),
  score: integer().default(0),
  payload: json().optional(),
}, { access: { read: "editor", create: "editor", update: "editor", delete: "editor" } });

export const echo = query({ access: "editor" }, ({ message }: { message: string }) => { if (message.length < 1) throw new HttpError(422, "invalid_input", "message must be at least 1 character", "/message"); if (message.length > 200) throw new HttpError(422, "invalid_input", "message must be at most 200 characters", "/message"); return ({ message, length: message.length }); });

export const advance = mutation({ access: "editor" }, async ({ id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  await db.update(records).set({ state: "processing" }).where({ id });
  return await db.query.records.findFirst({ where: { id } });
});

export default defineConfig({
  name: "official-plugins",
});
