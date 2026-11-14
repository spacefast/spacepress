import { defineCollection } from "astro:content";
import { firstLoader } from "@first/astro";

export const collections = {
  notes: defineCollection({ loader: firstLoader("notes") }),
};
