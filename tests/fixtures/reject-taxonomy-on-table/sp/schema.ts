import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "spacepress";
export const notes = table({ body: text() });
export const topics = taxonomy({}, { on: [notes] });
