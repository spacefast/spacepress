import { action, defineConfig, text } from "first";

import { getReadingTime } from "./first/backend/reading-time";

// The kinds are in first/kinds.ts: posts, pages, the category, tag and credits taxonomies, and the widgets global.
export const readingTime = action({
  input: { content: text() },
  access: "anyone",
  handler: ({ content }) => ({ minutes: getReadingTime([{ _type: "block", children: [{ _type: "span", text: content }] }]) }),
});

export default defineConfig({
  name: "emdash-starter",
  // Keep WordPress's complete native admin, plugin and settings screens.
  admin: false,
});
