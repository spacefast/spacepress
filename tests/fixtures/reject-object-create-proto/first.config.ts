import { action, defineConfig } from "first";
import { make } from "./first/lib.mjs";

export default defineConfig({
  actions: {
    read: action({ input: {}, handler: () => make() }),
  },
});
