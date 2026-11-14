// Prebuilt pages next to server-rendered ones (docs/decisions/2026-11-13-static-output.md): /about and
// each note are prebuilt; / and /live render per request.
import { defineConfig, collection, text, slug } from "first";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }),
}, { title: "title", url: "/notes/:slug", access: { read: (ctx) => (ctx.user ? true : { status: "published" }), create: "editor", update: "editor", delete: "editor" } });

export default defineConfig({ name: "prebuilt", collections: { notes } });
