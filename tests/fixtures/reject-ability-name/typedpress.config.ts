import { defineConfig, mutation } from "typedpress";
import { abilities } from "php/wordpress";
export const a = mutation({ access: "anyone" }, (i: { name: string }) => abilities.call(i.name, {}));

export default defineConfig({});
