import { defineConfig, mutation } from "typedpress";
import { the_title } from "php/wordpress";
export const a = mutation({ access: "anyone" }, () => the_title());

export default defineConfig({});
