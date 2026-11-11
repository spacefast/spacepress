import { action, defineConfig, env } from "first";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone",
  handler() { return env("API_KEY") ?? "unset"; } }) } });
