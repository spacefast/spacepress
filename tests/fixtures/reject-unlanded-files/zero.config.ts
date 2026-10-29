import { collection, id, text, file, files, defineConfig } from "zero";
const decks = collection("decks", { id: id(), title: text().notNull(), deck: file({ bucket: "decks" }) }, { editor: false });
export default defineConfig({ schema: { decks }, files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 20000000 }) } });
