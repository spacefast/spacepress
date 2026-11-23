import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "spacepress";
export const topics = taxonomy({});
export const posts = collection({ title: text(), topic: ref(topics) });
