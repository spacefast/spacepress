import { action, defineConfig } from "first";
export default defineConfig({ name: "globalthishost", actions: {
  probe: action({ input: {}, handler: () => typeof globalThis.Buffer }),
} });
