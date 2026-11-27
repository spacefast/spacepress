import { table, f } from "spacepress";
export const tags = table({ name: f.text() });
export const notes = table({ tags: f.ref(tags).many().unique() });
