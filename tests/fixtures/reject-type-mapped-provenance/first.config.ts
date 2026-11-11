import { action, defineConfig } from "first";
type Keys<T> = keyof T;
type Labels<T> = { [P in Keys<T>]: string };
const snapshot: Labels<{ note?: number }> = {};
export default defineConfig({
  tables: {},
  actions: { snapshot: action({ input: {}, handler: () => snapshot }) },
});
