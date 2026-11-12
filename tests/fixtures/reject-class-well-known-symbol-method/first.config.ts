import { action, defineConfig } from "first";
import { make } from "./first/lib.mjs";
export default defineConfig({ name: "classwellknownsymbolmethod", actions: {
  probe: action({ input: {}, handler: () => make() }),
} });
