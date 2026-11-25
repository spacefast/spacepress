import { defineConfig, mutation } from "spacepress";
import { abilities } from "php/wordpress";
export const a = mutation({ access: "anyone" }, () => abilities.call("acme/site-info", { field: "title" }));

export default defineConfig({});
