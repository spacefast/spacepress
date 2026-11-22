import { defineConfig, mutation } from "typedpress";
import lib from "./tp/lib.cjs";

export const read = mutation({}, () => lib.count);

export default defineConfig({});
