import { defineConfig, mutation } from "spacepress";
import lib from "./sp/lib.cjs";

export const read = mutation({}, () => lib.count);

export default defineConfig({});
