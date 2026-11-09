import { action, defineConfig } from "first";
const key = Symbol("key");
export default defineConfig({ name: "typescriptsymbol", actions: {
  probe: action({ input: {}, handler: () => typeof key }),
} });
