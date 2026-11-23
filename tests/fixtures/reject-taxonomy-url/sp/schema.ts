import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "spacepress";
export const topics = taxonomy({}, { url: "/topics/:name" });
