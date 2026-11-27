import { createDocsCollection } from "@spacepress/docs/schema";

export const docs = createDocsCollection({ label: "Docs", sync: "content/docs/**/*.md" });
