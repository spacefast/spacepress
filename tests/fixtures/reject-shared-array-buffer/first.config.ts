import { action, defineConfig } from "first";
import { make } from "./first/shared.mjs";
export const probe = action({ handler: () => { make(); return 1; } });

export default defineConfig({});
