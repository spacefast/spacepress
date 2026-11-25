import { ref, table, text } from "spacepress";
export const tags = table({ name: text() });
export const notes = table({ tags: ref(tags).many().unique() });
