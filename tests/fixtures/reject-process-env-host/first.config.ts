import { action, defineConfig } from "first";
export default defineConfig({ actions: { a: action({ access: "anyone",
  handler() { return process.env.DB_PASSWORD ?? null; } }) } });
