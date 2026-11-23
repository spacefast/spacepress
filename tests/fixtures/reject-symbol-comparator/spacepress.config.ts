import { defineConfig, mutation } from "spacepress";
const ORDER = [2, 1].sort(() => Symbol("order") as unknown as number);
export const order = mutation({}, () => ORDER);

export default defineConfig({ name: "symbolcomparator" });
