import { defineConfig, file, files, global, group } from "first";
const site = global({ assets: group({ brochure: file({ bucket: "decks" }).optional() }).optional() });
export default defineConfig({ collections: {}, globals: { site }, files: { decks: files({ accept: ["application/pdf"], maxBytes: 10 }) } });
