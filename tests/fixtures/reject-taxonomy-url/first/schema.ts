import { collection, global, ref, table, taxonomy, terms, text, richText, group } from "first";
export const topics = taxonomy({}, { url: "/topics/:name" });
