import { defineConfig, mutation } from "spacepress";
import { ORDER } from "./sp/order.mjs";
export const order = mutation({}, () => ORDER);

export default defineConfig({ name: "generatorcomparator" });
