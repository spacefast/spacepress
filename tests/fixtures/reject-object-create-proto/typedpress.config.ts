import { defineConfig, mutation } from "typedpress";
import { make } from "./tp/lib.mjs";

export const read = mutation({}, () => make());

export default defineConfig({});
