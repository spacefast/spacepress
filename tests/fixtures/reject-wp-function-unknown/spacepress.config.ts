import { defineConfig, mutation } from "spacepress";
import { the_title } from "php/wordpress";
export const a = mutation({ access: "anyone" }, () => the_title());

export default defineConfig({});
