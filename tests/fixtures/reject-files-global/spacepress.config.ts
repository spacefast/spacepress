import { defineConfig, files, global, f } from "spacepress";
export const decks = files({ accept: ["application/pdf"], maxBytes: 10 });
export const site = global({ assets: f.group({ brochure: f.file(decks).optional() }).optional() });
export default defineConfig({});
