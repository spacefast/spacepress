import { action, collection, defineConfig, files, file, global, text, table } from "first";
const privateFiles = table({ label: text(), deck: file({ bucket: "decks" }).optional() });
const roleRows = table({ display: text() });
const roles = table({ roleName: text() });
const records = table({ label: text() });
const recordRowOrders = table({ amount: text() });
export default defineConfig({ name: "pf", tables: { privateFiles, roleRows, roles, records, recordRowOrders }, globals: {
  prefs: global("prefs", { label: text().default("Ready").optional() }),
  prefsPatch: global("prefsPatch", { count: text().default("One").optional() }),
  prefsOutput: global("prefsOutput", { value: text().default("Value").optional() }),
}, actions: { prefs: action({ access: "anyone", handler() { return "Updated"; } }) }, files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 10 }) } });
