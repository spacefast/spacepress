import { id, table, text } from "zero";
// Registered by export; a hook below imports it from "zero:db".
export const badges = table({ id: id(), label: text().notNull() });
