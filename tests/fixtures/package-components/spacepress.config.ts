// An app whose Markdown blocks, stylesheet and client island come from an installed component
// library (node_modules/@acme/docs-ui), re-exported from sp/components/.
import { collection, defineConfig, richText, slug, text } from "spacepress";

export const docs = collection(
  { title: text(), slug: slug({ source: "title" }), content: richText().optional() },
  { url: "/docs/:slug", access: { read: "anyone" } },
);

export default defineConfig({ name: "pkgui" });
