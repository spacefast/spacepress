import { table, f } from "spacepress";
// Registered by export; a hook below imports it from "spacepress/server/db".
export const badges = table({ label: f.text() });
