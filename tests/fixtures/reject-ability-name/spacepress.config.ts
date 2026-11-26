import { defineConfig, mutation } from "spacepress";
import { abilities } from "spacepress/server/wp";
export const a = mutation({ access: "anyone" }, (i: { name: string }) => abilities.call(i.name, {}));

export default defineConfig({});
