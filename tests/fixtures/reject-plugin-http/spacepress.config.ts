import { defineConfig } from "spacepress";
import ping from "spacepress-plugin-ping";
export default defineConfig({ name: "ping", use: [ping()] });
