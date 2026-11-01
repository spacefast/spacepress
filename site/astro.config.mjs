// @ts-check
import { defineConfig } from "astro/config";

// Static output; SITE_URL and SITE_BASE come from the deploy (GitHub Pages sets both), so the
// same build serves a project page under a path or a domain at the root.
export default defineConfig({
  site: process.env.SITE_URL ?? "https://zero.spacefast.com",
  base: process.env.SITE_BASE ?? "/",
  output: "static",
  trailingSlash: "ignore",
});
