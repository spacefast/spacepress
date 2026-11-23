import { table, text } from "spacepress";
// Registered by export; a hook below imports it from "spacepress:db".
export const badges = table({ label: text() });
