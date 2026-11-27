import { collection, defineConfig, table, query, mutation, f } from "spacepress";
import { HttpError } from "spacepress/server";

// The four field-kit data shapes become native Secure Custom Fields controls.
export const entries = collection({
  title: f.text().min(1).max(160),
  body: f.richText().optional(),
  profile: f.group({ name: f.text().optional(), featured: f.boolean().optional() }).optional(),
  ingredients: f.repeater({ name: f.text(), quantity: f.integer().min(0).optional() }).optional(),
  grid: f.repeater({ monday: f.text().optional(), tuesday: f.text().optional() }).optional(),
  tags: f.json().optional(),
  palette: f.text().pattern(/^#[0-9a-fA-F]{6}$/).default("#375c48").optional(),
  embeds: f.json().optional(),
}, {
  title: "title", content: "body", label: "Plugin stories", comments: true,
  access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
}).on({ beforeCreate({ data }) { data.title = data.title.trim(); } });

export const records = table({
  externalId: f.text().max(120).unique(),
  state: f.select(["pending", "processing", "done"]).default("pending"),
  score: f.integer().default(0),
  payload: f.json().optional(),
}, { access: { read: "editor", create: "editor", update: "editor", delete: "editor" } });

export const echo = query({ access: "editor" }, (_ctx, { message }: { message: string }) => { if (message.length < 1) throw new HttpError(422, "invalid_input", "message must be at least 1 character", "/message"); if (message.length > 200) throw new HttpError(422, "invalid_input", "message must be at most 200 characters", "/message"); return ({ message, length: message.length }); });

export const advance = mutation({ access: "editor" }, async ({ db }, { id }: { id: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  await db.records.update(id, { state: "processing" });
  return await db.records.get(id);
});

export default defineConfig({
  name: "official-plugins",
});
