import {
  action,
  boolean,
  defineConfig,
  defineRelations,
  global,
  integer,
  table,
  text,
} from "first";
import {
  consume,
  itemHooks,
  items,
  locations,
  restock,
  shoppingList,
} from "./first/pantry";
import { stories } from "./first/stories";

export { stories } from "./first/stories";

export const tasks = table(
  {
    title: text().notNull().min(1).max(120),
    done: boolean().notNull().default(false),
    storyId: integer().references(() => stories.id, { onDelete: "set null" }),
    editorNote: text().access({ read: "editor" }),
  },
  {
    access: {
      read: "anyone",
      create: "editor",
      update: "editor",
      delete: "editor",
    },
  },
);

export const relations = defineRelations(
  { stories, tasks, items, locations, shoppingList },
  (r) => ({
    stories: { tasks: r.many.tasks(), pantryItems: r.many.items() },
    tasks: {
      story: r.one.stories({ from: r.tasks.storyId, to: r.stories.id }),
    },
    items: {
      story: r.one.stories({ from: r.items.storyId, to: r.stories.id }),
      location: r.one.locations({
        from: r.items.locationId,
        to: r.locations.id,
      }),
      shoppingEntry: r.one.shoppingList({
        from: r.items.id,
        to: r.shoppingList.itemId,
      }),
    },
    locations: { items: r.many.items() },
    shoppingList: {
      item: r.one.items({ from: r.shoppingList.itemId, to: r.items.id }),
    },
  }),
);

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

export default defineConfig({
  name: "showcase",
  admin: true,
  collections: { stories },
  tables: { tasks, locations, items, shoppingList },
  relations,
  globals: {
    settings: global(
      "settings",
      {
        title: text().notNull().default("The small things, shipped."),
        description: text().default("A working publication, built with First."),
      },
      { access: { read: "anyone", update: "editor" } },
    ),
  },
  media: { sizes: { card: { width: 960, height: 600, fit: "cover" } } },
  hooks: {
    items: itemHooks,
    tasks: {
      beforeCreate(data) {
        data.title = data.title.trim();
      },
    },
  },
  actions: {
    consume,
    restock,
    previewHeadline: action({
      access: "anyone",
      input: { title: text().notNull().min(1).max(120) },
      handler: ({ title }) => new Headline(title).preview(),
    }),
  },
});
