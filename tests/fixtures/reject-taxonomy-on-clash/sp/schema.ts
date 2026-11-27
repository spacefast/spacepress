import { collection, global, table, taxonomy, f } from "spacepress";
export const posts = collection({ title: f.text(), topics: f.text().optional() });
export const topics = taxonomy({}, { on: [posts] });
