import { defineCollection } from "astro:content";
import { loader } from "@typedpress/astro";

// The plants of the TypedPress app at TP_URL (the cms/ folder). The schema and the type of
// `entry.data` come from the site; each build pulls only the plants that changed.
export const collections = {
  plants: defineCollection({ loader: loader("plants") }),
};
