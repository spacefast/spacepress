import { collection, defineConfig, files, file, id, text } from "zero";
const privateFiles = collection("private_files", { id: id(), label: text().notNull(), deck: file({ bucket: "decks" }) }, { editor: false });
export default defineConfig({ name: "pf", schema: { privateFiles }, files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 10 }) } });
