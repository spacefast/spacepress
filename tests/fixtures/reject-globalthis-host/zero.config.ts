import { action, defineConfig } from "zero";
export default defineConfig({ name: "globalthishost", actions: {
  probe: action({ input: {}, handler: () => typeof globalThis.Buffer }),
} });
