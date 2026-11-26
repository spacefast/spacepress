import { defineConfig, mutation } from "spacepress";
import { abilities } from "spacepress/server/wp";
export const a = mutation({ access: "anyone" }, () => abilities.call("acme/site-info", { field: "title" }));

export default defineConfig({});
