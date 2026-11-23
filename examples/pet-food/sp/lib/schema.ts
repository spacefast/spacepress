import {
  boolean, collection, date, integer, media, richText,
  table, text, timestamp, type AccessCtx, number, select, ref, db,
} from "spacepress";
import { ownerId, ownFood, ownPet, queueStockCheck } from "./pantry";

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
  ownerId: integer().access({ update: false }).ui({
    label: "WordPress owner", help: "Assigned by the server to the signed-in user.",
  }),
};

export const pets = collection({
  ...ownership,
  name: text().min(1).ui({ label: "Pet name" }),
  species: text().min(1).ui({ label: "Species", placeholder: "Cat", width: 50 }),
  birthday: date().ui({ label: "Birthday", width: 50 }).optional(),
  weightKg: number().min(0.01).ui({ label: "Weight in kg", width: 50 }).optional(),
  dailyGrams: number().min(0.01).ui({
    label: "Daily food in grams", help: "Your feeding target. Projections use the actual feeding log.", width: 50,
  }),
  photo: media({ accept: "image" }).ui({ label: "Pet photo" }).optional(),
}, { label: "Pets", title: "name", access: ownerAccess }).on({
  beforeCreate(data, ctx) { data.ownerId = ownerId(ctx); data.name = data.name.trim(); },
  beforeUpdate(patch, existing) { patch.ownerId = existing.ownerId; },
});

export const foods = collection({
  ...ownership,
  product: text().min(1).ui({ label: "Product name" }),
  brand: text().min(1).ui({ label: "Brand", width: 50 }),
  kind: select(["dry", "wet", "treat"]).default("dry").ui({ label: "Food type", width: 50 }),
  bagGrams: number().min(0.01).ui({ label: "Pack weight in grams", width: 50 }),
  costCents: integer().min(0).ui({
    label: "Pack price in cents", help: "Use one currency throughout your pantry.", width: 50,
  }),
  photo: media({ accept: "image" }).ui({ label: "Pack photo" }).optional(),
}, { label: "Foods", title: "product", access: ownerAccess }).on({
  beforeCreate(data, ctx) { data.ownerId = ownerId(ctx); data.product = data.product.trim(); },
  beforeUpdate(patch, existing) { patch.ownerId = existing.ownerId; },
  async afterCreate(row) {
    // Create the owned candidate while the signed-in user's actor is available.
    await db.insert(shoppingList).values({ foodId: row.id, ownerId: row.ownerId });
    await queueStockCheck(row.id, row.ownerId);
  },
});

export const vetNotes = collection({
  ...ownership,
  title: text().min(1),
  petId: ref(pets).ui({ label: "Pet" }),
  body: richText().ui({ label: "Visit notes" }).optional(),
}, { label: "Vet notes", title: "title", content: "body", access: ownerAccess }).on({
  async beforeCreate(data, ctx) {
    data.ownerId = ownerId(ctx);
    await ownPet(data.petId, data.ownerId);
  },
  async beforeUpdate(patch, existing) {
    patch.ownerId = existing.ownerId;
    await ownPet(patch.petId ?? existing.petId, existing.ownerId);
  },
});

export const stock = table({
  ...ownership,
  foodId: ref(foods).ui({ label: "Food" }),
  gramsLeft: number().min(0).ui({ label: "Grams remaining" }),
  openedOn: date().ui({ label: "Opened on", help: "Leave empty for an unopened pack." }).optional(),
  expiresOn: date().ui({ label: "Use by", help: "Expired packs are excluded from feeding and forecasts." }).optional(),
}, { label: "Pantry stock", access: ownerAccess }).on({
  async beforeCreate(data, ctx) {
    data.ownerId = ownerId(ctx);
    await ownFood(data.foodId, data.ownerId);
  },
  async beforeUpdate(patch, existing) {
    patch.ownerId = existing.ownerId;
    await ownFood(patch.foodId ?? existing.foodId, existing.ownerId);
  },
  async afterCreate(row) { await queueStockCheck(row.foodId, row.ownerId); },
  async afterUpdate(row, previous) {
    await queueStockCheck(row.foodId, row.ownerId);
    if (previous.foodId !== row.foodId) await queueStockCheck(previous.foodId, previous.ownerId);
  },
  async afterDelete(row) { await queueStockCheck(row.foodId, row.ownerId); },
});

export const feedings = table({
  ...ownership,
  petId: ref(pets).ui({ label: "Pet" }),
  foodId: ref(foods).ui({ label: "Food" }),
  grams: number().min(0.01).ui({ label: "Grams served" }),
  fedAt: timestamp().defaultNow().ui({ label: "Fed at" }),
  costCents: number().min(0).ui({ label: "Meal cost in cents", help: "Pack price when this meal was logged." }),
}, {
  label: "Feeding history",
  access: { read: owned, create: false, update: false, delete: false },
}).on({
  async beforeCreate(data, ctx) {
    data.ownerId = ownerId(ctx);
    await ownPet(data.petId, data.ownerId);
    await ownFood(data.foodId, data.ownerId);
  },
});

export const shoppingList = table({
  ...ownership,
  foodId: ref(foods).unique().ui({ label: "Food" }).onDelete("cascade"),
  needed: boolean().default(false).ui({ label: "Needs restocking" }),
  checkedAt: timestamp().ui({ label: "Last stock check" }).optional(),
}, {
  label: "Shopping list",
  access: { read: owned, create: false, update: false, delete: false },
}).on({
  async beforeCreate(data, ctx) {
    data.ownerId = ownerId(ctx);
    await ownFood(data.foodId, data.ownerId);
  },
  beforeUpdate(patch, existing) { patch.ownerId = existing.ownerId; },
});
