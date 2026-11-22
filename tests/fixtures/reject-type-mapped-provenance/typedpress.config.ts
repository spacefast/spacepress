import { defineConfig, mutation } from "typedpress";
type Keys<T> = keyof T;
type Labels<T> = { [P in Keys<T>]: string };
const labels: Labels<{ note?: number }> = {};
export const snapshot = mutation({}, () => labels);
export default defineConfig({});
