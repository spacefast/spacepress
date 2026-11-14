import { action, defineConfig } from "first";
import { ORDER } from "./first/order.mjs";
export const order = action({ input: {}, handler: () => ORDER });

export default defineConfig({ name: "generatorcomparator" });
