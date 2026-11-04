import { action, collection, defineConfig, files, file, global, id, text, table } from "zero";
const privateFiles = table({ id: id(), label: text().notNull(), deck: file({ bucket: "decks" }) });
const roleRows = table({ display: text().notNull() });
const roles = table({ roleName: text().notNull() });
const records = table({ label: text().notNull() });
const recordRowOrders = table({ amount: text().notNull() });
export default defineConfig({ name: "pf", tables: { privateFiles, roleRows, roles, records, recordRowOrders }, globals: {
  prefs: global("prefs", { label: text().default("Ready") }),
  prefsPatch: global("prefsPatch", { count: text().default("One") }),
  prefsOutput: global("prefsOutput", { value: text().default("Value") }),
}, actions: { prefs: action({ access: "anyone", handler() { return "Updated"; } }) }, files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 10 }) } });
