import { ref, table, text } from "first";
export const tags = table({ noteId: ref("notes") });
