import { collection, global, table, taxonomy, f } from "spacepress";
export const topics = taxonomy({});
export const posts = collection({ title: f.text(), topic: f.ref(topics) });
