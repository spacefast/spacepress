import { table, text } from "spacepress";
export const notes = table({ title: text() }).on({ afterPublish(row) { void row; } });
