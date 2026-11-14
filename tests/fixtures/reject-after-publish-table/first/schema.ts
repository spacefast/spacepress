import { table, text } from "first";
export const notes = table({ title: text() }).on({ afterPublish(row) { void row; } });
