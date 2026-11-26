// A static export whose content lives on a hosted WordPress (`spacepress export --site`,
// docs/decisions/2026-11-13-static-output.md): notes are written there, the export renders them, and
// the cheer button calls the hosted site's public action from the static page.
import { defineConfig, collection, table, text, slug, integer, ref } from "spacepress";

export const notes = collection({
  title: text(),
  slug: slug({ source: "title" }),
}, { title: "title", url: "/notes/:slug", access: { read: (ctx) => (ctx.user ? true : { status: "published" }), create: "editor", update: "editor", delete: "editor" } });

export const cheers = table({
  noteId: ref(notes).unique(),
  count: integer().default(0),
}, { access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export default defineConfig({ name: "cms", output: "static" });
