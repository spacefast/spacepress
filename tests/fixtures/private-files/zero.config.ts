import { collection, defineConfig, files, file, id, text, table } from "zero";
const privateFiles = table({ id: id(), label: text().notNull(), deck: file({ bucket: "decks" }) });
const roleRows = table({ display: text().notNull() });
const roles = table({ roleName: text().notNull() });
export default defineConfig({ name: "pf", tables: { privateFiles, roleRows, roles }, files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 10 }) } });
