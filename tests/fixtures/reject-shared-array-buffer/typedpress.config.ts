import { defineConfig, mutation } from "typedpress";
import { make } from "./tp/shared.mjs";
export const probe = mutation({}, () => { make(); return 1; });

export default defineConfig({});
