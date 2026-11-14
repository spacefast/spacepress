import { action, defineConfig } from "first";
export const a = action({ access: "anyone",
  handler() { return process.env.DB_PASSWORD ?? null; } });
export default defineConfig({});
