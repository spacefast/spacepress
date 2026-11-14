import { action, defineConfig } from "first";
export const a = action({ input: {}, access: "anyone",
  handler() { return crypto.getRandomValues(new Uint8Array(16)).length; } });

export default defineConfig({});
