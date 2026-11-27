import { table, f } from "spacepress";
export const notes = table({ title: f.text(), likes: f.integer().default(0) }, { access: { read: "anyone", create: "anyone" } });
// Not a kind, action or job: ignored.
export const MAX_TITLE = 80;
