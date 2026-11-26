// The SpacePress site: a one-page guide, a playground, docs from Markdown and a blog, on SpacePress.
//   sp/schema.ts    the docs and the blog (WordPress content), and saved playground edits (a table)
//   sp/server.ts    the one server function: save a playground edit and get a link to it
//   sp/app/         the pages; sp/components/guide/ holds the guide's sections
//   content/           the docs and the first posts as Markdown; `spacepress sync` keeps the site equal to them
//   browser/           the scripts the pages load; scripts/build.mjs bundles them into public/
import { defineConfig } from "spacepress";

export * from "./sp/schema";
export * from "./sp/server";

export default defineConfig({ name: "spacepress-site" });
