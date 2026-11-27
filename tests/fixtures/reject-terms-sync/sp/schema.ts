import { collection, taxonomy, f } from "spacepress";
export const topics = taxonomy({});
export const notes = collection({ title: f.text(), topics: f.terms(topics) }, { sync: "content/notes/*.json" });
