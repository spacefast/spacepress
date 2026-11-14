import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "first";
export const topics = taxonomy({ posts: text().optional() });
export const posts = collection({ title: text(), topics: terms(topics) });
