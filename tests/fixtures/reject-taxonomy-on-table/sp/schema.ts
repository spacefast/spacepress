import { collection, global, table, taxonomy, f } from "spacepress";
export const notes = table({ body: f.text() });
export const topics = taxonomy({}, { on: [notes] });
