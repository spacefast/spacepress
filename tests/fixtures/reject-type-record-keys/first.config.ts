import { action, defineConfig } from "first";
type Flags = Record<"ready" | "visible", boolean>;
export const example = action({ input: {}, handler: () => { const value: Flags = { ready: true }; return value; } });

export default defineConfig({});
