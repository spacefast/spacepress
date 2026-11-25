import { collection, taxonomy, terms, text } from "spacepress";
export const topics = taxonomy({});
export const notes = collection({ title: text(), topics: terms(topics) }, { sync: "content/notes/*.json" });
