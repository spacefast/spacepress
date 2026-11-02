import { action, defineConfig } from "zero";
type Keys<T> = keyof T;
type Labels<T> = { [P in Keys<T>]: string };
const snapshot: Labels<{ note?: number }> = {};
export default defineConfig({
  schema: {},
  actions: { snapshot: action({ input: {}, handler: () => snapshot }) },
});
