import { ref, table, text } from "spacepress";
export const tags = table({ noteId: ref("notes") });
