import { action, defineConfig } from "first";
import lib from "./first/lib.cjs";

export default defineConfig({
  actions: {
    read: action({ input: {}, handler: () => lib.count }),
  },
});
