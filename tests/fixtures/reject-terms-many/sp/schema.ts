import { collection, global, table, taxonomy, f } from "spacepress";
export const topics = taxonomy({});
export const posts = collection({ title: f.text(), topics: f.terms(topics).many() });
