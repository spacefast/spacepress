import { table, text } from "typedpress";
export const notes = table({ title: text() }).on({ afterPublish(row) { void row; } });
