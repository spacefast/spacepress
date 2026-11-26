import { defineConfig, mutation } from "spacepress";
import { make } from "./sp/lib.mjs";
export const probe = mutation({}, () => make());

export default defineConfig({ name: "classcomputedstringkey" });
