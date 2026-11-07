import { action, defineConfig } from "zero";
import { make } from "./shared.mjs";
export default defineConfig({ actions: { probe: action({ handler: () => { make(); return 1; } }) } });
