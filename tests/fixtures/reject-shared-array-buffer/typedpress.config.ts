import { action, defineConfig } from "typedpress";
import { make } from "./tp/shared.mjs";
export const probe = action({ handler: () => { make(); return 1; } });

export default defineConfig({});
