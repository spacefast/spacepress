import { defineConfig, route } from "first";
export default defineConfig({ routes: {
  files: route({ method: "GET", path: "/files/*path/meta", access: "anyone", handler() { return { body: "" }; } }),
} });
