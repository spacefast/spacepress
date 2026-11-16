// The TypedPress site: a one-page guide, a playground, docs from Markdown and a blog, on TypedPress.
//   tp/schema.ts    the docs and the blog (WordPress content), and saved playground edits (a table)
//   tp/server.ts    the one server function: save a playground edit and get a link to it
//   tp/app/         the pages; tp/components/guide/ holds the guide's sections
//   content/           the docs and the first posts as Markdown; `typedpress sync` keeps the site equal to them
//   browser/           the scripts the pages load; scripts/build.mjs bundles them into public/
import { defineConfig } from "typedpress";

export * from "./tp/schema";
export * from "./tp/server";

export default defineConfig({ name: "typedpress-site" });
