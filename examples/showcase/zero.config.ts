import {
  action,
  blocks,
  boolean,
  collection,
  defineConfig,
  defineRelations,
  global,
  group,
  integer,
  json,
  media,
  repeater,
  richText,
  table,
  text,
} from "zero";
import {
  consume,
  itemHooks,
  items,
  locations,
  restock,
  shoppingList,
} from "./pantry";

export const stories = collection(
  {
    title: text().notNull().min(1).max(120),
    body: richText(),
    cover: media({ accept: "image" }),
    details: group({
      fields: { subtitle: text(), featured: boolean().default(false) },
    }),
    links: repeater({
      fields: { label: text().notNull(), href: text().notNull() },
    }),
    sections: blocks({
      layouts: {
        quote: { text: text().notNull(), cite: text() },
        callout: { heading: text().notNull(), body: text() },
      },
    }),
    metadata: json(),
  },
  {
    title: "title",
    content: "body",
    label: "Stories",
    access: {
      read: "anyone",
      create: "editor",
      update: "editor",
      delete: "editor",
    },
  },
);

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
    stories: { tasks: r.many.tasks() },
    tasks: {
      story: r.one.stories({ from: r.tasks.storyId, to: r.stories.id }),
    },
    items: {
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
        description: text().default("A working publication, built with Zero."),
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
