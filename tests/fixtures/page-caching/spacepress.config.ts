// What a write purges and what a page may share (tests/app_router.rs `page_caching_*`): a kind with
// a URL, a catalog filtered by a declared `search` parameter, a page that shows the top-ranked row,
// an item page, a page that reads nothing, and a global two of them print.
import { collection, defineConfig, global, f } from "spacepress";

export const drives = collection({
  name: f.text(),
  slug: f.slug({ source: "name" }).optional(),
  media: f.text().default("hdd"),
  price: f.number().default(1),
  stock: f.integer().default(0),
}, {
  title: "name",
  access: { read: (ctx) => (ctx.user ? true : { status: "published" }), create: "editor", update: "editor", delete: "editor" },
});

export const shop = global({ currency: f.text().default("USD") }, { access: { read: "anyone", update: "editor" } });

export default defineConfig({ name: "pagecaching" });
