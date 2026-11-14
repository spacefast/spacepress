// Negative checks: each @ts-expect-error must be consumed by a real mistake.
import {
  action, blocks, boolean, collection, db, defineConfig, global, HttpError, integer, media, repeater, richText, select, text, url,
  table, ref,
} from "first";
import { authors, comments, items, locations, posts, entities, settings, shoppingList, UNITS } from "./schema";
import type { AppRelations } from "./register";

async function filters() {
  // Unknown column in a where filter
  // @ts-expect-error `quantiy` is not a column of items
  await db.query.items.findMany({ where: { quantiy: { gt: 0 } } });

  // Unknown operator
  // @ts-expect-error `greaterThan` is not a filter operator
  await db.query.items.findMany({ where: { quantity: { greaterThan: 0 } } });

  // Wrong value type in a filter
  // @ts-expect-error quantity is a number
  await db.query.items.findFirst({ where: { quantity: "3" } });

  // Unknown column in update/delete where
  // @ts-expect-error `nme` is not a column of shopping_list
  await db.delete(shoppingList).where({ nme: "milk" });

  // Unknown relation in `with`
  // @ts-expect-error items has no `shelf` relation
  await db.query.items.findMany({ with: { shelf: true } });

  // Unknown collection key
  // @ts-expect-error there is no `pantry` collection
  await db.query.pantry.findMany();

  // orderBy direction
  // @ts-expect-error orderBy is "asc" | "desc"
  await db.query.items.findMany({ orderBy: { name: "up" } });
}

async function writes() {
  // Wrong value type for a column in values()
  // @ts-expect-error quantity is a number
  await db.insert(items).values({ name: "milk", quantity: "two" });

  // Missing required insert field
  // @ts-expect-error `name` is NOT NULL without a default
  await db.insert(items).values({ quantity: 2 });

  // Enum value outside the union
  // @ts-expect-error "tons" is not one of UNITS
  await db.insert(items).values({ name: "flour", unit: "tons" });

  // Unknown column in set()
  // @ts-expect-error `qty` is not a column of items
  await db.update(items).set({ qty: 1 });
}

async function relationsNotLoaded() {
  const item = await db.query.items.findFirst({ where: { id: 1 } });
  // @ts-expect-error a `ref()` field holds its id until `with` loads it
  item?.locationId.name;

  const loc = await db.query.locations.findFirst({ columns: { name: true } });
  // @ts-expect-error `kind` was excluded by `columns`
  loc?.kind;
}

// Enum default outside the union
// @ts-expect-error "attic" is not a location kind
select(["fridge", "pantry"]).default("attic").optional();

// Enum value on a select row
declare const unit: (typeof items)["$inferSelect"]["unit"];
// @ts-expect-error "tons" is not comparable with UNITS
if (unit === "tons") void UNITS;

// references() must point at a column of the same type
// @ts-expect-error locations.name is text, not integer
integer().references(() => locations.name).optional();

// defaultNow() only exists on timestamp/date
// @ts-expect-error integer columns have no `now`
integer().defaultNow().optional();

// Hook mistakes: one `.on()` per mistake, since tsc reports only the first assignability failure
// inside a single argument.
items.on({
  // @ts-expect-error misspelled hook name
  beforeCreated(data: unknown) {
    void data;
  },
});

items.on({
  beforeUpdate(patch) {
    // @ts-expect-error quantity is a number
    patch.quantity = "lots";
  },
  // @ts-expect-error afterCreate receives a row, not a string
  afterCreate(row: string) {
    void row;
  },
});

action({
  input: { itemId: integer() },
  handler({ itemId }) {
    // @ts-expect-error itemId is a number
    const s: string = itemId;
    // @ts-expect-error HttpError takes (status, code, message)
    if (!s) throw new HttpError(404, "not found");
    return s;
  },
});

// The registry keys are gone: kinds, globals, actions and jobs register by export (spec §1.1).
// @ts-expect-error `tables` is not a defineConfig option
defineConfig({ tables: { locations } });
// @ts-expect-error `hooks` is not a defineConfig option
defineConfig({ hooks: {} });
// @ts-expect-error `actions` is not a defineConfig option
defineConfig({ actions: {} });

// --- v1 additions (design §1) ---

// Per-kind modifiers (§1.2)
// @ts-expect-error `.max()` isn't valid on a boolean column
boolean().max(1).optional();
// @ts-expect-error `.pattern()` is for plain strings; richText isn't one
richText().pattern(/x/).optional();
// @ts-expect-error media columns have no default
media().default(1).optional();
// @ts-expect-error `.validate` gets the non-null value: a string here, not a number
text().validate((v) => (v > 3 ? true : "short")).optional();

// Access (§1.6)
collection({ title: text() }, {
  // @ts-expect-error "moderator" is not a role
  access: { read: "moderator" },
});
table({ body: text() }, {
  // @ts-expect-error create access rules return booleans
  access: { create: (ctx) => ({ body: ctx.user?.name ?? "" }) },
});
table({ body: text() }, {
  // @ts-expect-error filter values must match the field
  access: { update: () => ({ body: 1 }) },
});
// @ts-expect-error drafts can't be turned off for editor collections
collection({ body: text() }, { drafts: false });
collection({ body: text().optional() }, {
  // @ts-expect-error the title column must be a NOT NULL text column
  title: "body",
});

async function v1Queries() {
  // @ts-expect-error `has` is for list columns; title is a scalar
  await db.query.posts.findMany({ where: { title: { has: "x" } } });
  // @ts-expect-error list columns take `has`, not `in`
  await db.query.posts.findMany({ where: { tags: { in: ["news"] } } });
  // @ts-expect-error "blog" isn't a tag option
  await db.query.posts.findMany({ where: { tags: { has: "blog" } } });
  // @ts-expect-error JSON-valued columns can't be ordered
  await db.query.posts.findMany({ orderBy: { seo: "asc" } });
  // @ts-expect-error tables have no drafts columns
  await db.query.comments.findMany({ where: { status: "published" } });
  // @ts-expect-error repeater items need their NOT NULL sub-field `image`
  await db.update(posts).set({ gallery: [{ caption: "no image" }] });
  // @ts-expect-error blocks items are discriminated by `layout`: a hero has no `text`
  await db.update(posts).set({ sections: [{ layout: "hero", text: "quote text" }] });
  // @ts-expect-error unknown layout
  await db.update(posts).set({ sections: [{ layout: "video", heading: "x" }] });
  // @ts-expect-error global fields are typed: postsPerPage is a number
  await db.globals.settings.update({ postsPerPage: "10" });
  // @ts-expect-error there is no `footer` global
  await db.globals.footer.get();
}

// Hook ctx (§1.7)
posts.on({
  afterCreate(row, ctx) {
    // @ts-expect-error ctx.user may be null (anonymous writers, trusted callers)
    void ctx.user.id;
    // @ts-expect-error there is no build target on ctx
    void ctx.target;
  },
  // @ts-expect-error the trailing argument is HookCtx, not a user
  beforeDelete(row, user: { role: string; email: string }) {
    void row, user;
  },
});

action({
  input: { id: integer() },
  // @ts-expect-error action access is a gate: no filters
  access: () => ({ id: 1 }),
  handler: ({ id }, ctx) => ctx.user?.role === "admin" && id,
});

defineConfig({
  // @ts-expect-error there is no build target option
  target: "wp",
});

// Globals (§1.5)
// @ts-expect-error global field defaults are typed: postsPerPage is an integer
global({ postsPerPage: integer().default("ten") });
// @ts-expect-error repeater sub-fields keep their kinds: href is a url (string)
global({ items: repeater({ href: url() }).default([{ href: 1 }]).optional() });

// Structured fields (§1.1)
// @ts-expect-error blocks layout items are typed: `heading` is text
blocks({ hero: { heading: text() } }).default([{ layout: "hero", heading: 1 }]).optional();
// @ts-expect-error select(multiple) defaults are lists of options
select(["a", "b"]).many().default(["c"]).optional();

void v1Queries; void authors; void comments; void settings;

// fetch and crypto are the standard globals, not "first" exports.
// @ts-expect-error "first" has no fetch
export { fetch } from "first";
// @ts-expect-error "first" has no crypto
export { crypto } from "first";
// @ts-expect-error a many-ref's links go with a deleted target, or refuse it: no setNull
ref(locations).many().onDelete("setNull");
// @ts-expect-error a many-ref takes no default
ref(locations).many().default([1]);
