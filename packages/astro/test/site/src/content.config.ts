import { defineCollection } from "astro:content";
import { spLoader } from "@spacepress/astro";

export const collections = {
  notes: defineCollection({ loader: spLoader("notes") }),
};
