import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "spacepress";
export const posts = collection({ title: text(), topics: text().optional() });
export const topics = taxonomy({}, { on: [posts] });
