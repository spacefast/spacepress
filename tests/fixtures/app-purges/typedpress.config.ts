// What one write purges (tests/app_router.rs `one_write_announces_its_purges_once`): a kind with a
// URL, a home page that lists it, its item page, and a prebuilt page that reads one item.
import { defineConfig, collection, text, slug } from "typedpress";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }),
}, { title: "title", url: "/notes/:slug", access: { read: (ctx) => (ctx.user ? true : { status: "published" }), create: "editor", update: "editor", delete: "editor" } });

export default defineConfig({ name: "purges" });
