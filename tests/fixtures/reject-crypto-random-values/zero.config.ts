import { action, defineConfig } from "zero";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone",
  handler() { return crypto.getRandomValues(new Uint8Array(16)).length; } }) } });
