import { table, text, integer, id } from "zero";
export const notes = table({ id: id(), title: text().notNull(), likes: integer().notNull().default(0) }, { access: { read: "anyone", create: "anyone" } });
// Not a kind, action or job: ignored.
export const MAX_TITLE = 80;
