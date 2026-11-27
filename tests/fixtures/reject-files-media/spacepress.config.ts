import { defineConfig, files, table, f } from "spacepress";
export const notes = table({ x: f.text().optional() });
// `media` is the WordPress media library's name: a bucket can't take it.
export const media = files({ accept: ["image/*"], maxBytes: 100 });
export default defineConfig({});
