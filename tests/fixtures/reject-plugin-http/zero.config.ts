import { defineConfig } from "zero";
import ping from "zero-plugin-ping";
export default defineConfig({ name: "ping", use: [ping()] });
