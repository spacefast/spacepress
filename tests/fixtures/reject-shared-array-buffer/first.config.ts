import { action, defineConfig } from "first";
import { make } from "./first/shared.mjs";
export default defineConfig({ actions: { probe: action({ handler: () => { make(); return 1; } }) } });
