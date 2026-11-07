import { defineConfig, route } from "zero";
export default defineConfig({ routes: {
  files: route({ method: "GET", path: "/files/*path/meta", access: "anyone", handler() { return { body: "" }; } }),
} });
