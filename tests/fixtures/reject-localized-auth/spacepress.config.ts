import { defineConfig, extend, f } from "spacepress";
export const notes = extend("users", { fields: { name: f.text().localized().optional() } });
export default defineConfig({ locales: { default: "en", all: ["en"] } });
