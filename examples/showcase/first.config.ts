import {
  action,
  boolean,
  defineConfig,
  global,
  integer,
  table,
  text, ref,
} from "first";
import {
  consume,
  items,
  locations,
  restock,
  shoppingList,
} from "./first/pantry";
import { stories } from "./first/stories";

export { stories } from "./first/stories";

export const tasks = table(
  {
    title: text().min(1).max(120),
    done: boolean().default(false),
    storyId: ref(() => stories).optional(),
    editorNote: text().access({ read: "editor" }).optional(),
  },
  {
    access: {
      read: "anyone",
      create: "editor",
      update: "editor",
      delete: "editor",
    },
  },
).on({
  beforeCreate(data) {
    data.title = data.title.trim();
  },
});

class Headline {
  constructor(public text: string) {}
  preview() {
    const title = this.text.trim();
    return {
      title,
      slug: title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      characters: title.length,
    };
  }
}

export const settings = global(
  {
    title: text().default("The small things, shipped."),
    description: text().default("A working publication, built with First.").optional(),
  },
  { access: { read: "anyone", update: "editor" } },
);

export const previewHeadline = action({
  access: "anyone",
  input: { title: text().min(1).max(120) },
  handler: ({ title }) => new Headline(title).preview(),
});

export default defineConfig({
  name: "showcase",
  media: { sizes: { card: { width: 960, height: 600, fit: "cover" } } },
});
