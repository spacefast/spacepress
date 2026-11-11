import { defineConfig } from "first";
import ping from "first-plugin-ping";
export default defineConfig({ name: "ping", use: [ping()] });
