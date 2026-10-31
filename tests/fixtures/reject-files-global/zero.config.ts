import { defineConfig, file, files, global } from "zero";
const site = global("site", { brochure: file({ bucket: "decks" }) });
export default defineConfig({ schema: {}, globals: { site }, files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 10 }) } });
