import { group, ref, table, text } from "typedpress";
export const tags = table({ name: text() });
export const notes = table({ meta: group({ tags: ref(tags).many() }) });
