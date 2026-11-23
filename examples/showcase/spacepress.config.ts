import {
  boolean,
  defineConfig,
  global,
  table,
  text, ref, query, HttpError,
} from "spacepress";
import {
  consume,
  items,
  locations,
  restock,
  shoppingList,
} from "./sp/pantry";
import { stories } from "./sp/stories";

export { stories } from "./sp/stories";

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
    description: text().default("A working publication, built with SpacePress.").optional(),
  },
  { access: { read: "anyone", update: "editor" } },
);

export const previewHeadline = query({ access: "anyone" }, ({ title }: { title: string }) => { if (title.length < 1) throw new HttpError(422, "invalid_input", "title must be at least 1 character", "/title"); if (title.length > 120) throw new HttpError(422, "invalid_input", "title must be at most 120 characters", "/title"); return new Headline(title).preview(); });

export default defineConfig({
  name: "showcase",
  media: { sizes: { card: { width: 960, height: 600, fit: "cover" } } },
});
