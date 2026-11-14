import { defineConfig, file, files, global, group } from "first";
export const decks = files({ accept: ["application/pdf"], maxBytes: 10 });
const site = global({ assets: group({ brochure: file(decks).optional() }).optional() });
export default defineConfig({ collections: {}, globals: { site }, files: { decks } });
