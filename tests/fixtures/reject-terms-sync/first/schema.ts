import { collection, taxonomy, terms, text } from "first";
export const topics = taxonomy({});
export const notes = collection({ title: text(), topics: terms(topics) }, { sync: "content/notes/*.json" });
