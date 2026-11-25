import { defineConfig, mutation } from "spacepress";
import { get_post } from "php/wordpress";
export const a = mutation({ access: "anyone" }, () => get_post("12"));

export default defineConfig({});
