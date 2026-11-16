import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "typedpress";
export const topics = taxonomy({}, { url: "/topics/:name" });
