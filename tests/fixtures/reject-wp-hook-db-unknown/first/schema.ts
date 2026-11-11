import { table, text, id } from "first";
export const notes = table({ id: id(), title: text().notNull() });
