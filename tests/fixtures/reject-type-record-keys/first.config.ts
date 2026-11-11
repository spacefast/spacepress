import { action, defineConfig } from "first";
type Flags = Record<"ready" | "visible", boolean>;
export default defineConfig({ tables: {}, actions: { example: action({ input: {}, handler: () => { const value: Flags = { ready: true }; return value; } }) } });
