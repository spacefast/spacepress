import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "first";
export const topics = taxonomy({});
export const posts = collection({ title: text(), topics: terms(topics).min(1) });
