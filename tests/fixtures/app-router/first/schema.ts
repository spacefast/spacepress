import { collection, text, slug } from "first";

export const notes = collection({
  title: text().notNull(),
  slug: slug({ source: "title" }),
  secret: text().access({ read: "editor" }),
}, { title: "title" });
