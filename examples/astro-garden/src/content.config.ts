import { defineCollection } from "astro:content";
import { spLoader } from "@spacepress/astro";

// The plants of the SpacePress app at SP_URL (examples/garden). The schema and the type of
// `entry.data` come from the site; each build pulls only the plants that changed.
export const collections = {
  plants: defineCollection({ loader: spLoader("plants") }),
};
