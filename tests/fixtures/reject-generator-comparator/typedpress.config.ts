import { action, defineConfig } from "typedpress";
import { ORDER } from "./tp/order.mjs";
export const order = action({ input: {}, handler: () => ORDER });

export default defineConfig({ name: "generatorcomparator" });
