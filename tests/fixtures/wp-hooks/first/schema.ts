import { table, text } from "first";
// Registered by export; a hook below imports it from "first:db".
export const badges = table({ label: text() });
