import { action, defineConfig } from "first";
const ORDER = [2, 1].sort(() => Symbol("order") as unknown as number);
export default defineConfig({ name: "symbolcomparator", actions: {
  order: action({ input: {}, handler: () => ORDER }),
} });
