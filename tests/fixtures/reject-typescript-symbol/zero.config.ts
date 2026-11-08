import { action, defineConfig } from "zero";
const key = Symbol("key");
export default defineConfig({ name: "typescriptsymbol", actions: {
  probe: action({ input: {}, handler: () => typeof key }),
} });
