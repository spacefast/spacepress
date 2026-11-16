import { action, defineConfig } from "typedpress";
export const a = action({ access: "anyone",
  handler() { return process.env.DB_PASSWORD ?? null; } });
export default defineConfig({});
