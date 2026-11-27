import { defineConfig } from "spacepress";
import reach from "spacepress-plugin-reach";
export default defineConfig({ name: "reach", use: [reach()] });
