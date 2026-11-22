import { defineConfig, mutation } from "typedpress";
const key = Symbol("key");
export const probe = mutation({}, () => typeof key);

export default defineConfig({ name: "typescriptsymbol" });
