// Prebuilt pages next to server-rendered ones (docs/decisions/2026-11-13-static-output.md): /about and
// each note are prebuilt; / and /live render per request.
import { defineConfig, collection, text, slug } from "typedpress";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }),
  // Stored as post meta, not a core post field: an edit to it reaches no core post hook.
  summary: text().optional(),
}, { title: "title", url: "/notes/:slug", access: { read: (ctx) => (ctx.user ? true : { status: "published" }), create: "editor", update: "editor", delete: "editor" } });

export default defineConfig({ name: "prebuilt" });
