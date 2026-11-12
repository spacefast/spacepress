import { action, defineConfig } from "first";
import { ORDER } from "./first/order.mjs";
export default defineConfig({ name: "generatorcomparator", actions: {
  order: action({ input: {}, handler: () => ORDER }),
} });
