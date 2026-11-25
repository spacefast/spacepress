import { defineConfig, mutation } from "spacepress";
import { half } from "./sp/half.mjs";

// A high surrogate with no low surrogate after it is a string UTF-8 can't hold.
export const run = mutation({}, () => ({ v: half() }));

export default defineConfig({});
