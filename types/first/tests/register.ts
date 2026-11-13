// The registration `first build` generates into first/_generated/db.d.ts: the kinds, and the relations
// each `ref()` field gives (the field itself, and the reverse list on its target). `config` types
// globals and jobs.
import type { Many, One, Relations } from "first";
import type { entities } from "./schema";
import type config from "./inference";
type Graph = {
  locations: { items: Many<"items"> };
  items: { locationId: One<"locations", true>; shoppingList: Many<"shoppingList"> };
  shoppingList: { itemId: One<"items", true> };
  authors: { posts: Many<"posts"> };
  posts: { authorId: One<"authors", true>; comments: Many<"comments"> };
  comments: { postId: One<"posts", false> };
};
export type AppRelations = Relations<typeof entities, Graph>;
declare module "first" { interface Register { relations: AppRelations; config: typeof config; locales: "en" | "de" } }
