import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "first";
export const tags = collection({ title: text() });
export const posts = collection({ title: text(), tags: terms(tags) });
