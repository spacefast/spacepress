import { action, defineConfig } from "first";
const ORDER = [2, 1].sort(() => Symbol("order") as unknown as number);
export const order = action({ input: {}, handler: () => ORDER });

export default defineConfig({ name: "symbolcomparator" });
