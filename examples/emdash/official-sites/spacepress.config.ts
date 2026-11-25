import { defineConfig, text, query } from "spacepress";

import { getReadingTime } from "./sp/backend/reading-time";

// The kinds are in sp/kinds.ts: posts, pages, the category, tag and credits taxonomies, and the widgets global.
export const readingTime = query({ access: "anyone" }, ({ content }: { content: string }) => ({ minutes: getReadingTime([{ _type: "block", children: [{ _type: "span", text: content }] }]) }));

export default defineConfig({
  name: "emdash-starter",
  // Keep WordPress's complete native admin, plugin and settings screens.
  admin: false,
});
