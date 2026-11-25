import { defineConfig, mutation } from "spacepress";
import { make } from "./sp/shared.mjs";
export const probe = mutation({}, () => { make(); return 1; });

export default defineConfig({});
