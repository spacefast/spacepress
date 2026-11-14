import { action, defineConfig } from "first";
export const probe = action({ input: {}, handler: () => typeof globalThis.Buffer });

export default defineConfig({ name: "globalthishost" });
