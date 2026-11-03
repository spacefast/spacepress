// @ts-check
import path from "node:path";
import { defineConfig } from "astro/config";
import { rehypeHighlight } from "./src/lib/highlight.ts";
import { remarkRepoLinks } from "./src/lib/links.ts";

// Static output; SITE_URL and SITE_BASE come from the deploy (GitHub Pages sets both), so the
// same build serves a project page under a path or a domain at the root.
const base = process.env.SITE_BASE ?? "/";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://zero.spacefast.com",
  base,
  output: "static",
  trailingSlash: "ignore",
  markdown: {
    syntaxHighlight: false,
    remarkPlugins: [[remarkRepoLinks, { base: base.replace(/\/$/, ""), repo: path.resolve("..") }]],
    rehypePlugins: [rehypeHighlight],
  },
});
