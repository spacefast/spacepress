import { table, text, integer } from "spacepress";
export const notes = table({ title: text(), likes: integer().default(0) }, { access: { read: "anyone", create: "anyone" } });
// Not a kind, action or job: ignored.
export const MAX_TITLE = 80;
