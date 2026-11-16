import { table, text, boolean } from "typedpress";

export const tasks = table({
  text: text(),
  isCompleted: boolean().default(false),
}, { access: { read: "anyone" } });
