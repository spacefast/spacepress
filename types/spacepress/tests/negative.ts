// Negative checks: each @ts-expect-error must be consumed by a real mistake.
import { collection, defineConfig, f, global, mutation, query, table, taxonomy } from "spacepress";
import { db, HttpError } from "spacepress/server";
import { authors, comments, items, locations, posts, settings, UNITS } from "./schema";

async function filters() {
  // Unknown column in a where filter
  // @ts-expect-error `quantiy` is not a column of items
  await db.items.list({ where: { quantiy: { gt: 0 } } });

  // Unknown operator
  // @ts-expect-error `greaterThan` is not a filter operator
  await db.items.list({ where: { quantity: { greaterThan: 0 } } });

  // Wrong value type in a filter
  // @ts-expect-error quantity is a number
  await db.items.get({ where: { quantity: "3" } });

  // Unknown relation in `with`
  // @ts-expect-error items has no `shelf` relation
  await db.items.list({ with: { shelf: true } });

  // Unknown collection key
  // @ts-expect-error there is no `pantry` collection
  await db.pantry.list();

  // orderBy direction
  // @ts-expect-error orderBy is "asc" | "desc"
  await db.items.list({ orderBy: { name: "up" } });
}

async function writes() {
  // Wrong value type for a column in create()
  // @ts-expect-error quantity is a number
  await db.items.create({ name: "milk", quantity: "two" });

  // Missing required insert field
  // @ts-expect-error `name` is NOT NULL without a default
  await db.items.create({ quantity: 2 });

  // Enum value outside the union
  // @ts-expect-error "tons" is not one of UNITS
  await db.items.create({ name: "flour", unit: "tons" });

  // Unknown column in update()
  // @ts-expect-error `qty` is not a column of items
  await db.items.update(1, { qty: 1 });
}

async function relationsNotLoaded() {
  const item = await db.items.get(1);
  // @ts-expect-error a `f.ref()` field holds its id until `with` loads it
  item?.locationId.name;

  const loc = await db.locations.get(1, { columns: { name: true } });
  // @ts-expect-error `kind` was excluded by `columns`
  loc?.kind;
}

// Enum default outside the union
// @ts-expect-error "attic" is not a location kind
f.select(["fridge", "pantry"]).default("attic").optional();

// Enum value on a select row
declare const unit: (typeof items)["$inferSelect"]["unit"];
// @ts-expect-error "tons" is not comparable with UNITS
if (unit === "tons") void UNITS;

// references() must point at a column of the same type
// @ts-expect-error locations.name is text, not integer
f.integer().references(() => locations.name).optional();

// defaultNow() only exists on timestamp/date
// @ts-expect-error integer columns have no `now`
f.integer().defaultNow().optional();

// Hook mistakes: one `.on()` per mistake, since tsc reports only the first assignability failure
// inside a single argument.
items.on({
  // @ts-expect-error misspelled hook name
  beforeCreated(ctx: unknown) {
    void ctx;
  },
});

items.on({
  beforeUpdate({ patch }) {
    // @ts-expect-error quantity is a number
    patch.quantity = "lots";
  },
  // @ts-expect-error afterCreate receives a ctx object, not a string
  afterCreate(row: string) {
    void row;
  },
});

mutation({}, (_ctx, { itemId }: { itemId: number }) => {
  // @ts-expect-error itemId is a number
  const s: string = itemId;
  // @ts-expect-error HttpError takes (status, code, message)
  if (!s) throw new HttpError(404, "not found");
  return s;
});

// The registry keys are gone: kinds, globals, actions and jobs register by export.
// @ts-expect-error `tables` is not a defineConfig option
defineConfig({ tables: { locations } });
// @ts-expect-error `hooks` is not a defineConfig option
defineConfig({ hooks: {} });
// @ts-expect-error `actions` is not a defineConfig option
defineConfig({ actions: {} });
// @ts-expect-error `files` is not a defineConfig option
defineConfig({ files: {} });

// Per-kind modifiers
// @ts-expect-error `.max()` isn't valid on a boolean column
f.boolean().max(1).optional();
// @ts-expect-error `.pattern()` is for plain strings; richText isn't one
f.richText().pattern(/x/).optional();
// @ts-expect-error media columns have no default
f.media().default(1).optional();
// @ts-expect-error `.validate` gets the non-null value: a string here, not a number
f.text().validate((v) => (v > 3 ? true : "short")).optional();

// Access
collection({ title: f.text() }, {
  // @ts-expect-error "moderator" is not a role
  access: { read: "moderator" },
});
table({ body: f.text() }, {
  // @ts-expect-error create access rules return booleans
  access: { create: (ctx) => ({ body: ctx.user?.name ?? "" }) },
});
table({ body: f.text() }, {
  // @ts-expect-error filter values must match the field
  access: { update: () => ({ body: 1 }) },
});
// @ts-expect-error drafts can't be turned off for editor collections
collection({ body: f.text() }, { drafts: false });
collection({ body: f.text().optional() }, {
  // @ts-expect-error the title column must be a NOT NULL text column
  title: "body",
});

async function v1Queries() {
  // @ts-expect-error `has` is for list columns; title is a scalar
  await db.posts.list({ where: { title: { has: "x" } } });
  // @ts-expect-error list columns take `has`, not `in`
  await db.posts.list({ where: { tags: { in: ["news"] } } });
  // @ts-expect-error "blog" isn't a tag option
  await db.posts.list({ where: { tags: { has: "blog" } } });
  // @ts-expect-error JSON-valued columns can't be ordered
  await db.posts.list({ orderBy: { seo: "asc" } });
  // @ts-expect-error tables have no drafts columns
  await db.comments.list({ where: { status: "published" } });
  // @ts-expect-error repeater items need their NOT NULL sub-field `image`
  await db.posts.update(1, { gallery: [{ caption: "no image" }] });
  // @ts-expect-error blocks items are discriminated by `layout`: a hero has no `text`
  await db.posts.update(1, { sections: [{ layout: "hero", text: "quote text" }] });
  // @ts-expect-error unknown layout
  await db.posts.update(1, { sections: [{ layout: "video", heading: "x" }] });
  // @ts-expect-error global fields are typed: postsPerPage is a number
  await db.settings.update({ postsPerPage: "10" });
  // @ts-expect-error there is no `footer` global
  await db.footer.get();
}

// Hook ctx
posts.on({
  afterCreate({ user, ...rest }) {
    // @ts-expect-error user may be null (anonymous writers, trusted callers)
    void user.id;
    // @ts-expect-error there is no build target on ctx
    void rest.target;
  },
  // @ts-expect-error beforeDelete receives an object ctx, not positional args
  beforeDelete(row, user: { role: string; email: string }) {
    void row, user;
  },
});

mutation({
  // @ts-expect-error access is a gate: no filters
  access: () => ({ id: 1 }),
}, (ctx, { id }: { id: number }) => ctx.user?.role === "admin" && id);

// @ts-expect-error the handler comes after the options
mutation({ handler: async () => 1 });
// @ts-expect-error a query only reads: no destructive option
query({ destructive: true }, async () => 1);
// @ts-expect-error a rate limit is a count per period
mutation({ rateLimit: "10 per minute" }, async () => 1);

defineConfig({
  // @ts-expect-error there is no build target option
  target: "wp",
});

// Globals
// @ts-expect-error global field defaults are typed: postsPerPage is an integer
global({ postsPerPage: f.integer().default("ten") });
// @ts-expect-error repeater sub-fields keep their kinds: href is a url (string)
global({ items: f.repeater({ href: f.url() }).default([{ href: 1 }]).optional() });

// Structured fields
// @ts-expect-error blocks layout items are typed: `heading` is text
f.blocks({ hero: { heading: f.text() } }).default([{ layout: "hero", heading: 1 }]).optional();
// @ts-expect-error select(multiple) defaults are lists of options
f.select(["a", "b"]).many().default(["c"]).optional();

void filters; void writes; void relationsNotLoaded; void v1Queries; void authors; void comments; void settings;

// fetch and crypto are the standard globals, not "spacepress" exports.
// @ts-expect-error "spacepress" has no fetch
export { fetch } from "spacepress";
// @ts-expect-error "spacepress" has no crypto
export { crypto } from "spacepress";
// @ts-expect-error destructiveMigrations lives only on "spacepress/danger", never the main barrel
export { destructiveMigrations } from "spacepress";
// @ts-expect-error a many-ref's links go with a deleted target, or refuse it: no setNull
f.ref(locations).many().onDelete("setNull");
// @ts-expect-error a many-ref takes no default
f.ref(locations).many().default([1]);
// @ts-expect-error a terms field is already a list
f.terms(taxonomy()).many();
// @ts-expect-error terms() takes a taxonomy
f.terms(locations);
// @ts-expect-error term fields take no richText yet
taxonomy({ body: f.richText() });
