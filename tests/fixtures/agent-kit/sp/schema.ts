import { collection, table, f } from "spacepress";

export const articles = collection({
  title: f.text().max(160),
  body: f.richText().optional(),
  reviewNote: f.text().access({ read: "editor" }).optional(),
}, { title: "title", content: "body", access: { read: "anyone", create: "author", update: "editor", delete: "editor" } });

export const shoppingList = table({
  name: f.text(),
  quantity: f.integer().min(1).default(1),
  aisle: f.select(["produce", "dairy", "pantry"]).optional(),
  done: f.boolean().default(false),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } }).on({
  beforeCreate: ({ data }) => {
    data.name = data.name.trim();
  },
});

export const substitutes = table({
  item: f.ref(shoppingList).onDelete("cascade"),
  name: f.text(),
});
