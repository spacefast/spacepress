import { defineCollection } from "astro:content";
import { firstLoader } from "@first/astro";

// The plants of the First app at FIRST_URL (examples/garden). The schema and the type of
// `entry.data` come from the site; each build pulls only the plants that changed.
export const collections = {
  plants: defineCollection({ loader: firstLoader("plants") }),
};
