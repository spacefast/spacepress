import { defineConfig, files, table, text } from "spacepress";
export const notes = table({ x: text().optional() });
// `media` is the WordPress media library's name: a bucket can't take it.
export const media = files({ accept: ["image/*"], maxBytes: 100 });
export default defineConfig({});
