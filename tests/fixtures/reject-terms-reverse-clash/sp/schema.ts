import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "spacepress";
export const topics = taxonomy({ posts: text().optional() });
export const posts = collection({ title: text(), topics: terms(topics) });
