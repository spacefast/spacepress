import { defineConfig, route } from "zero";
export default defineConfig({ routes: {
  files: route({ method: "GET", path: "/files/*path", access: "anyone", handler(req) { return { body: req.params["path"] ?? "" }; } }),
  latest: route({ method: "GET", path: "/files/:bucket/latest", access: "anyone", handler(req) { return { body: req.params["bucket"] ?? "" }; } }),
} });
