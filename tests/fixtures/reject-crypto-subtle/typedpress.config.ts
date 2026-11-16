import { action, defineConfig, text } from "typedpress";
export const a = action({ input: { d: text() }, access: "anyone",
  async handler(i) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(i.d)); } });

export default defineConfig({});
