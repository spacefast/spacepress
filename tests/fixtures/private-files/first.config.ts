import { action, collection, defineConfig, files, file, global, text, table } from "first";
export const decks = files({ accept: ["application/pdf"], maxBytes: 10 });

const privateFiles = table({ label: text(), deck: file(decks).optional() });
const roleRows = table({ display: text() });
const roles = table({ roleName: text() });
const records = table({ label: text() });
const recordRowOrders = table({ amount: text() });
export default defineConfig({ name: "pf", tables: { privateFiles, roleRows, roles, records, recordRowOrders }, globals: {
  prefs: global({ label: text().default("Ready").optional() }),
  prefsPatch: global({ count: text().default("One").optional() }),
  prefsOutput: global({ value: text().default("Value").optional() }),
}, actions: { prefs: action({ access: "anyone", handler() { return "Updated"; } }) }, files: { decks } });
