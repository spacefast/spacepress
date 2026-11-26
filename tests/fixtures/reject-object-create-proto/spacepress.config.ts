import { defineConfig, mutation } from "spacepress";
import { make } from "./sp/lib.mjs";

export const read = mutation({}, () => make());

export default defineConfig({});
