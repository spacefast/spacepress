import { collection, defineConfig, global, table, f } from "spacepress";

export const notes = table({ body: f.text().optional() });

export const settings = global({ secret: f.text().access({ read: "editor" }).optional() });

export default defineConfig({});
