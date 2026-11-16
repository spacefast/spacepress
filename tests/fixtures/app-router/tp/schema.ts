import { collection, text, slug } from "typedpress";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }).optional(),
  secret: text().access({ read: "editor" }).optional(),
}, { title: "title" });
