import { defineConfig, file, files, global, group } from "zero";
const site = global("site", { assets: group({ fields: { brochure: file({ bucket: "decks" }) } }) });
export default defineConfig({ collections: {}, globals: { site }, files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 10 }) } });
