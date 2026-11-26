import { createDocsCollection } from "@spacepress/docs/schema";

export const docs = createDocsCollection({ label: "Docs", url: "/docs/:path", sync: "content/docs/**/*.md" });
