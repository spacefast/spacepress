import {
  boolean, collection, date, defineRelations, integer, media, real, richText,
  table, text, timestamp, type AccessCtx,
} from "first";

export function owned(ctx: AccessCtx) {
  return ctx.user && ctx.user.role !== "guest" ? { ownerId: ctx.user.id } : false;
}

export const ownerAccess = {
  read: owned,
  create: (ctx: AccessCtx) => ctx.user !== null && ctx.user.role !== "guest",
  update: owned,
  delete: owned,
};

const ownership = {
  ownerId: integer().notNull().access({ update: false }).ui({
    label: "WordPress owner", help: "Assigned by the server to the signed-in user.",
  }),
};

export const pets = collection({
  ...ownership,
  name: text().notNull().min(1).ui({ label: "Pet name" }),
  species: text().notNull().min(1).ui({ label: "Species", placeholder: "Cat", width: 50 }),
  birthday: date().ui({ label: "Birthday", width: 50 }),
  weightKg: real().min(0.01).ui({ label: "Weight in kg", width: 50 }),
  dailyGrams: real().notNull().min(0.01).ui({
    label: "Daily food in grams", help: "Your feeding target. Projections use the actual feeding log.", width: 50,
  }),
  photo: media({ accept: "image" }).ui({ label: "Pet photo" }),
}, { label: "Pets", title: "name", access: ownerAccess });

export const foods = collection({
  ...ownership,
  product: text().notNull().min(1).ui({ label: "Product name" }),
  brand: text().notNull().min(1).ui({ label: "Brand", width: 50 }),
  kind: text({ enum: ["dry", "wet", "treat"] }).notNull().default("dry")
    .ui({ label: "Food type", width: 50 }),
  bagGrams: real().notNull().min(0.01).ui({ label: "Pack weight in grams", width: 50 }),
  costCents: integer().notNull().min(0).ui({
    label: "Pack price in cents", help: "Use one currency throughout your pantry.", width: 50,
  }),
  photo: media({ accept: "image" }).ui({ label: "Pack photo" }),
}, { label: "Foods", title: "product", access: ownerAccess });

export const vetNotes = collection({
  ...ownership,
  title: text().notNull().min(1),
  petId: integer().notNull().references(() => pets.id, { onDelete: "restrict" })
    .ui({ label: "Pet" }),
  body: richText().ui({ label: "Visit notes" }),
}, { label: "Vet notes", title: "title", content: "body", access: ownerAccess });

export const stock = table({
  ...ownership,
  foodId: integer().notNull().references(() => foods.id, { onDelete: "restrict" })
    .ui({ label: "Food" }),
  gramsLeft: real().notNull().min(0).ui({ label: "Grams remaining" }),
  openedOn: date().ui({ label: "Opened on", help: "Leave empty for an unopened pack." }),
  expiresOn: date().ui({ label: "Use by", help: "Expired packs are excluded from feeding and forecasts." }),
}, { label: "Pantry stock", access: ownerAccess });

export const feedings = table({
  ...ownership,
  petId: integer().notNull().references(() => pets.id, { onDelete: "restrict" }).ui({ label: "Pet" }),
  foodId: integer().notNull().references(() => foods.id, { onDelete: "restrict" }).ui({ label: "Food" }),
  grams: real().notNull().min(0.01).ui({ label: "Grams served" }),
  fedAt: timestamp().notNull().defaultNow().ui({ label: "Fed at" }),
  costCents: real().notNull().min(0).ui({ label: "Meal cost in cents", help: "Pack price when this meal was logged." }),
}, {
  label: "Feeding history",
  access: { read: owned, create: false, update: false, delete: false },
});

export const shoppingList = table({
  ...ownership,
  foodId: integer().notNull().unique().references(() => foods.id, { onDelete: "cascade" })
    .ui({ label: "Food" }),
  needed: boolean().notNull().default(false).ui({ label: "Needs restocking" }),
  checkedAt: timestamp().ui({ label: "Last stock check" }),
}, {
  label: "Shopping list",
  access: { read: owned, create: false, update: false, delete: false },
});

export const collections = { pets, foods, vetNotes };
export const tables = { stock, feedings, shoppingList };
export const relations = defineRelations({ ...collections, ...tables }, (r) => ({
  pets: { vetNotes: r.many.vetNotes(), feedings: r.many.feedings() },
  foods: { stock: r.many.stock(), feedings: r.many.feedings(), shoppingList: r.many.shoppingList() },
  vetNotes: { pet: r.one.pets({ from: r.vetNotes.petId, to: r.pets.id }) },
  stock: { food: r.one.foods({ from: r.stock.foodId, to: r.foods.id }) },
  feedings: {
    pet: r.one.pets({ from: r.feedings.petId, to: r.pets.id }),
    food: r.one.foods({ from: r.feedings.foodId, to: r.foods.id }),
  },
  shoppingList: { food: r.one.foods({ from: r.shoppingList.foodId, to: r.foods.id }) },
}));
