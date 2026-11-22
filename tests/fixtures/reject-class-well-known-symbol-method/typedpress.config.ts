import { defineConfig, mutation } from "typedpress";
import { make } from "./tp/lib.mjs";
export const probe = mutation({}, () => make());

export default defineConfig({ name: "classwellknownsymbolmethod" });
