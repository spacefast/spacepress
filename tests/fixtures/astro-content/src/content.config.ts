// The content collections of an Astro blog, kept as they are; SpacePress reads the glob ones as kinds.
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { spLoader } from "@spacepress/astro";

const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.md" }),
  schema: z.object({
    title: z.string(),
    description: z.string().min(1),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    heroImage: z.string().optional(),
    tags: z.array(z.string()).default([]),
    topics: z.array(z.enum(["astro", "first"])).optional(),
    category: z.enum(["news", "guide"]).default("news"),
    rank: z.number().int().nonnegative().optional(),
    draft: z.boolean().default(false),
    homepage: z.string().url().optional(),
  }),
});

export const collections = {
  blog,
  authors: defineCollection({
    loader: glob({ pattern: "*.md", base: "src/content/authors" }),
    schema: z.object({ name: z.string(), email: z.string().email().optional() }),
  }),
  // Read from another site: Astro's own, not a SpacePress kind.
  remote: defineCollection({ loader: spLoader("posts") }),
};
