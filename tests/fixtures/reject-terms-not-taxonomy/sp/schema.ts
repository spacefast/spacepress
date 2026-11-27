import { collection, global, table, taxonomy, f } from "spacepress";
export const tags = collection({ title: f.text() });
export const posts = collection({ title: f.text(), tags: f.terms(tags) });
