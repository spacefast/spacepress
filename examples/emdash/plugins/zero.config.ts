import {
  action, boolean, collection, db, defineConfig, group, integer,
  json, repeater, richText, table, text,
} from "zero";

// The four field-kit data shapes become native Secure Custom Fields controls.
const entries = collection({
  title: text().notNull().min(1).max(160),
  body: richText(),
  profile: group({ fields: { name: text(), featured: boolean() } }),
  ingredients: repeater({ fields: { name: text().notNull(), quantity: integer().min(0) } }),
  grid: repeater({ fields: { monday: text(), tuesday: text() } }),
  tags: json(),
  palette: text().pattern(/^#[0-9a-fA-F]{6}$/).default("#375c48"),
  embeds: json(),
}, {
  title: "title", content: "body", label: "Plugin stories",
  access: { read: "anyone", create: "editor", update: "editor", delete: "editor" },
});

const records = table({
  externalId: text().notNull().max(120).unique(),
  state: text({ enum: ["pending", "processing", "done"] }).notNull().default("pending"),
  score: integer().notNull().default(0),
  payload: json(),
}, { access: { read: "editor", create: "editor", update: "editor", delete: "editor" } });

export default defineConfig({
  name: "official-plugins",
  admin: true,
  collections: { entries },
  tables: { records },
  hooks: {
    entries: { beforeCreate(data) { data.title = data.title.trim(); } },
  },
  actions: {
    echo: action({
      access: "editor", input: { message: text().notNull().min(1).max(200) },
      handler: ({ message }) => ({ message, length: message.length }),
    }),
    advance: action({
      access: "editor", input: { id: integer().notNull() },
      handler: async ({ id }) => {
        await db.update(records).set({ state: "processing" }).where({ id });
        return await db.query.records.findFirst({ where: { id } });
      },
    }),
  },
});
