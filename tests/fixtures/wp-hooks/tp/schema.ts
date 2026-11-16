import { table, text } from "typedpress";
// Registered by export; a hook below imports it from "typedpress:db".
export const badges = table({ label: text() });
