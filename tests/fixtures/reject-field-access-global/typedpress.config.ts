import { collection, defineConfig, global, text, table } from "typedpress";

export const notes = table({ body: text().optional() });

export const settings = global({ secret: text().access({ read: "editor" }).optional() });

export default defineConfig({});
