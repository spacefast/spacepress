import { defineCollection } from "astro:content";
import { tpLoader } from "@typedpress/astro";

export const collections = {
  notes: defineCollection({ loader: tpLoader("notes") }),
};
