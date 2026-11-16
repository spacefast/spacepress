import { defineCollection } from "astro:content";
import { tpLoader } from "@typedpress/astro";

// The plants of the TypedPress app at TP_URL (examples/garden). The schema and the type of
// `entry.data` come from the site; each build pulls only the plants that changed.
export const collections = {
  plants: defineCollection({ loader: tpLoader("plants") }),
};
