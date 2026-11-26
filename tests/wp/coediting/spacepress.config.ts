import { collection, db, defineConfig, integer, richText, table, taxonomy, terms, text } from "spacepress";

export const hiddenTags = taxonomy({});
export const articles = collection({ title: text(), labels: terms(hiddenTags) });

export const edits = table({
  documentId: integer(), title: text(), summary: text().optional(), actor: text(),
}, { access: { read: "admin", create: "admin", update: "admin", delete: false } });

export const documents = collection({
  title: text(), body: richText().optional(), summary: text().optional(),
}, { title: "title", content: "body" });

documents.on({
  async afterUpdate(row, previous, ctx) {
    await db.insert(edits).values({
      documentId: row.id, title: row.title, summary: row.summary,
      actor: ctx.user ? ctx.user.name : "anonymous",
    });
  },
});

export default defineConfig({ name: "coediting", plugins: {
  gutenberg: { version: "24.4.1", sha256: "bdd790a279bc35c750dd70253658868df105ff29e04fb6db5aeb82fd4d3e0b02" },
} });
