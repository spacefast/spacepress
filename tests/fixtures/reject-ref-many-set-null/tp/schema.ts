import { ref, table, text } from "typedpress";
export const tags = table({ name: text() });
export const notes = table({ tags: ref(tags).many().onDelete("setNull") });
