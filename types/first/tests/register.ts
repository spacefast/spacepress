// The registration `first build` generates into first/_generated/db.d.ts: the kinds, and the relations
// each `ref()` field gives (the field itself, and the reverse list on its target), the globals and
// the jobs.
import type { Many, One, Relations } from "first";
import type { entities, settings } from "./schema";
import type { sendWelcome } from "./inference";
type Graph = {
  locations: { items: Many<"items"> };
  items: { locationId: One<"locations", true>; shoppingList: Many<"shoppingList"> };
  shoppingList: { itemId: One<"items", true> };
  authors: { posts: Many<"posts"> };
  posts: { authorId: One<"authors", true>; related: Many<"posts">; relatedFrom: Many<"posts">; comments: Many<"comments">; topics: Many<"topics"> };
  notes: { labelIds: Many<"labels"> };
  topics: { posts: Many<"posts"> };
  labels: { labelled: Many<"notes"> };
  comments: { postId: One<"posts", false> };
};
export type AppRelations = Relations<typeof entities, Graph>;
declare module "first" { interface Register { relations: AppRelations; globals: { settings: typeof settings }; jobs: { sendWelcome: typeof sendWelcome }; locales: "en" | "de" } }
