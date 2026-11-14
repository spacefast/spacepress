import { action, collection, defineConfig, files, file, global, text, table } from "first";
export const decks = files({ accept: ["application/pdf"], maxBytes: 10 });

export const privateFiles = table({ label: text(), deck: file(decks).optional() });
export const roleRows = table({ display: text() });
export const roles = table({ roleName: text() });
export const records = table({ label: text() });
export const recordRowOrders = table({ amount: text() });
export const prefs = global({ label: text().default("Ready").optional() });
export const prefsPatch = global({ count: text().default("One").optional() });
export const prefsOutput = global({ value: text().default("Value").optional() });

// An action may not share a name with the `prefs` global: names are one namespace (spec §1.1).
export const updatePrefs = action({ access: "anyone", handler() { return "Updated"; } });

export default defineConfig({ name: "pf" });
