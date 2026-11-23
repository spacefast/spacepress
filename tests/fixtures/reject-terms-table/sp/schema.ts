import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "spacepress";
export const topics = taxonomy({});
export const notes = table({ body: text(), topics: terms(topics) });
