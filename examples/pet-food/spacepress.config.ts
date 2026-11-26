import { defineConfig, number, query, mutation } from "spacepress";
import { db, HttpError } from "spacepress/server";
import { feedings, stock, shoppingList } from "./sp/lib/schema";
import { DAY_MS, WINDOW_DAYS, ownerId, ownFood, ownPet, projection, queueStockCheck, usableStock } from "./sp/lib/pantry";

export const feed = mutation({ access: "subscriber", idempotent: true }, async (input: { petId: number; foodId: number; grams: number; fedAt?: string }, ctx) => {
  if (!Number.isInteger(input.petId)) throw new HttpError(422, "invalid_input", "petId must be an integer", "/petId");
  if (!Number.isInteger(input.foodId)) throw new HttpError(422, "invalid_input", "foodId must be an integer", "/foodId");
  if (input.grams < 0.01) throw new HttpError(422, "invalid_input", "grams must be at least 0.01", "/grams");
  const owner = ownerId(ctx);
  await ownPet(input.petId, owner);
  const food = await ownFood(input.foodId, owner);
  const now = Date.now();
  const fedAt = input.fedAt ?? new Date(now).toISOString();
  if (new Date(fedAt).getTime() > now) {
    throw new HttpError(422, "invalid_input", "A feeding cannot be in the future.");
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const lots = await usableStock(input.foodId, owner, today);
  const available = lots.reduce((sum, lot) => sum + lot.gramsLeft, 0);
  if (available < input.grams) throw new HttpError(409, "insufficient_stock", "Not enough unexpired food.");
  let remaining = input.grams;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const served = Math.min(remaining, lot.gramsLeft);
    const [updated] = await db.update(stock).set({
      gramsLeft: lot.gramsLeft - served, openedOn: lot.openedOn ?? today,
    }).where({ id: lot.id, ownerId: owner, gramsLeft: lot.gramsLeft }).returning();
    if (!updated) throw new HttpError(409, "stock_changed", "Stock changed. Retry the feeding.");
    remaining -= served;
  }
  const [feeding] = await db.insert(feedings).values({
    petId: input.petId, foodId: input.foodId, grams: input.grams, fedAt, ownerId: owner,
    costCents: input.grams * food.costCents / food.bagGrams,
  }).returning();
  await queueStockCheck(food.id, owner);
  return { feeding, grams: input.grams };
});

export const runsOutOn = query({ access: "subscriber" }, async (input: { foodId: number }, ctx) => { if (!Number.isInteger(input.foodId)) throw new HttpError(422, "invalid_input", "foodId must be an integer", "/foodId"); return await projection(input.foodId, ownerId(ctx)); });

export const costPerMonth = query({ access: "subscriber" }, async (input: { petId: number }, ctx) => {
  if (!Number.isInteger(input.petId)) throw new HttpError(422, "invalid_input", "petId must be an integer", "/petId");
  const owner = ownerId(ctx);
  await ownPet(input.petId, owner);
  const now = Date.now();
  const meals = await db.query.feedings.findMany({ where: {
    petId: input.petId, ownerId: owner,
    fedAt: { gte: new Date(now - WINDOW_DAYS * DAY_MS).toISOString(), lte: new Date(now).toISOString() },
  } });
  const total = meals.reduce((sum, meal) => sum + meal.costCents, 0);
  return { petId: input.petId, costCents: Math.round(total / WINDOW_DAYS * 30) };
});

export const restockList = mutation({ access: "subscriber" }, async (input: {}, ctx) => {
  const owner = ownerId(ctx);
  const foods = await db.query.foods.findMany({ where: { ownerId: owner } });
  const result = [];
  for (const food of foods) {
    const forecast = await projection(food.id, owner);
    if (forecast.needsRestock) result.push(forecast);
    await queueStockCheck(food.id, owner);
  }
  return result;
});

export default defineConfig({
  name: "pet-food",
});
