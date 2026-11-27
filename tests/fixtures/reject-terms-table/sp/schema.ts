import { collection, global, table, taxonomy, f } from "spacepress";
export const topics = taxonomy({});
export const notes = table({ body: f.text(), topics: f.terms(topics) });
