import { table, f } from "spacepress";
export const notes = table({ title: f.text() }).on({ onPublish(row) { void row; } });
