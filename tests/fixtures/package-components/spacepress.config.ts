// An app whose Markdown blocks, stylesheet and client island come from an installed component
// library (node_modules/@acme/docs-ui), re-exported from sp/components/.
import { collection, defineConfig, f } from "spacepress";

export const docs = collection(
  { title: f.text(), slug: f.slug({ source: "title" }), content: f.richText().optional() },
  { access: { read: "anyone" } },
);

export default defineConfig({ name: "pkgui", permalinks: { docs: "/docs/:slug" } });
