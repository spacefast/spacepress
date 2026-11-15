// The TypedPress site: a one-page guide, a playground, docs from Markdown and a blog, on First.
//   first/schema.ts    the docs and the blog (WordPress content), and saved playground edits (a table)
//   first/server.ts    the one server function: save a playground edit and get a link to it
//   first/app/         the pages; first/components/guide/ holds the guide's sections
//   content/           the docs and the first posts as Markdown; `first sync` keeps the site equal to them
//   browser/           the scripts the pages load; scripts/build.mjs bundles them into public/
import { defineConfig } from "first";

export * from "./first/schema";
export * from "./first/server";

export default defineConfig({ name: "typedpress-site" });
