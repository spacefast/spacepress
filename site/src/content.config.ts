// The docs: the Markdown under ../docs and the README, as committed. Design records (docs/design-*.md)
// and research notes are the repository's, not the site's.
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

export const collections = {
  docs: defineCollection({
    loader: glob({
      base: "../docs",
      pattern: ["*.md", "!design-*.md", "!research-*.md"],
    }),
    schema: z.object({}),
  }),
};
