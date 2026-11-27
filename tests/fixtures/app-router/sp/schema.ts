import { collection, f } from "spacepress";

export const notes = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }).optional(),
  secret: f.text().access({ read: "editor" }).optional(),
}, { title: "title" });
