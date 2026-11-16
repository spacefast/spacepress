import { collection, table, text, integer, boolean, richText, select, ref } from "typedpress";

export const articles = collection({
  title: text().max(160),
  body: richText().optional(),
  reviewNote: text().access({ read: "editor" }).optional(),
}, { title: "title", content: "body", access: { read: "anyone", create: "author", update: "editor", delete: "editor" } });

export const shoppingList = table({
  name: text(),
  quantity: integer().min(1).default(1),
  aisle: select(["produce", "dairy", "pantry"]).optional(),
  done: boolean().default(false),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "admin" } }).on({
  beforeCreate: (data) => {
    data.name = data.name.trim();
  },
});

export const substitutes = table({
  item: ref(shoppingList).onDelete("cascade"),
  name: text(),
});
