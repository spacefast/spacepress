import { defineConfig, mutation } from "typedpress";
import { ORDER } from "./tp/order.mjs";
export const order = mutation({}, () => ORDER);

export default defineConfig({ name: "generatorcomparator" });
