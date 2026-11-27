import { collection, global, table, taxonomy, f } from "spacepress";
export const topics = taxonomy({});
export const posts = collection({ title: f.text(), meta: f.group({ topics: f.terms(topics) }) });
