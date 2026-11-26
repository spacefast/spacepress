import { defineConfig, mutation } from "spacepress";
import { the_title } from "spacepress/server/wp";
export const a = mutation({ access: "anyone" }, () => the_title());

export default defineConfig({});
