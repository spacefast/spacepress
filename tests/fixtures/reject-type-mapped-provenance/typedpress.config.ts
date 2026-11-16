import { action, defineConfig } from "typedpress";
type Keys<T> = keyof T;
type Labels<T> = { [P in Keys<T>]: string };
const labels: Labels<{ note?: number }> = {};
export const snapshot = action({ input: {}, handler: () => labels });
export default defineConfig({});
