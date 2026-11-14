import { action, defineConfig, env } from "first";
export const a = action({ input: {}, access: "anyone",
  handler() { return env("API_KEY") ?? "unset"; } });

export default defineConfig({});
