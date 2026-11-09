import { table, text, id } from "zero";
export const notes = table({ id: id(), title: text().notNull() });
