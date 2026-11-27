import { table, f } from "spacepress";
export const tags = table({ noteId: f.ref("notes") });
