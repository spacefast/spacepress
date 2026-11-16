import { defineConfig } from "typedpress";
import ping from "typedpress-plugin-ping";
export default defineConfig({ name: "ping", use: [ping()] });
