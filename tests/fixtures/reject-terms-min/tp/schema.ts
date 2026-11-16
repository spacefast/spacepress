import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "typedpress";
export const topics = taxonomy({});
export const posts = collection({ title: text(), topics: terms(topics).min(1) });
