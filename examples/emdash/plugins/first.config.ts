import {
  action, boolean, collection, db, defineConfig, group, integer,
  json, repeater, richText, table, text, select,
} from "first";

// The four field-kit data shapes become native Secure Custom Fields controls.
const entries = collection({
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
});

const records = table({
  externalId: text().max(120).unique(),
  state: select(["pending", "processing", "done"]).default("pending"),
  score: integer().default(0),
  payload: json().optional(),
}, { access: { read: "editor", create: "editor", update: "editor", delete: "editor" } });

export default defineConfig({
  name: "official-plugins",
  collections: { entries },
  tables: { records },
  hooks: {
    entries: { beforeCreate(data) { data.title = data.title.trim(); } },
  },
  actions: {
    echo: action({
      access: "editor", input: { message: text().min(1).max(200) },
      handler: ({ message }) => ({ message, length: message.length }),
    }),
    advance: action({
      access: "editor", input: { id: integer() },
      handler: async ({ id }) => {
        await db.update(records).set({ state: "processing" }).where({ id });
        return await db.query.records.findFirst({ where: { id } });
      },
    }),
  },
});
