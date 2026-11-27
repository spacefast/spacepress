import { collection, defineConfig, files, global, table, mutation, f } from "spacepress";
export const decks = files({ accept: ["application/pdf"], maxBytes: 10 });

export const privateFiles = table({ label: f.text(), deck: f.file(decks).optional() });
export const roleRows = table({ display: f.text() });
export const roles = table({ roleName: f.text() });
export const records = table({ label: f.text() });
export const recordRowOrders = table({ amount: f.text() });
export const prefs = global({ label: f.text().default("Ready").optional() });
export const prefsPatch = global({ count: f.text().default("One").optional() });
export const prefsOutput = global({ value: f.text().default("Value").optional() });

// An action may not share a name with the `prefs` global: names are one namespace (spec §1.1).
export const updatePrefs = mutation({ access: "anyone" }, () => { return "Updated"; });

export default defineConfig({ name: "pf" });
