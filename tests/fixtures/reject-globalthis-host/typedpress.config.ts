import { action, defineConfig } from "typedpress";
export const probe = action({ input: {}, handler: () => typeof globalThis.Buffer });

export default defineConfig({ name: "globalthishost" });
