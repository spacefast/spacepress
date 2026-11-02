import { collection, defineConfig, files, file, id, text, table } from "zero";
const privateFiles = table({ id: id(), label: text().notNull(), deck: file({ bucket: "decks" }) });
export default defineConfig({ name: "pf", tables: { privateFiles }, files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 10 }) } });
