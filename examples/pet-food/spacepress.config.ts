import { defineConfig, mutation, query } from "spacepress";
import { HttpError } from "spacepress/server";
import { DAY_MS, WINDOW_DAYS, ownerId, ownFood, ownPet, projection, queueStockCheck, usableStock } from "./sp/lib/pantry";

export const feed = mutation({ access: "subscriber", idempotent: true }, async ({ db, user }, input: { petId: number; foodId: number; grams: number; fedAt?: string }) => {
  if (!Number.isInteger(input.petId)) throw new HttpError(422, "invalid_input", "petId must be an integer", "/petId");
  if (!Number.isInteger(input.foodId)) throw new HttpError(422, "invalid_input", "foodId must be an integer", "/foodId");
  if (input.grams < 0.01) throw new HttpError(422, "invalid_input", "grams must be at least 0.01", "/grams");
  const owner = ownerId({ user });
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
    await db.system.stock.update(lot.id, {
      gramsLeft: lot.gramsLeft - served, openedOn: lot.openedOn ?? today,
    });
    remaining -= served;
  }
  const feeding = await db.system.feedings.create({
    petId: input.petId, foodId: input.foodId, grams: input.grams, fedAt, ownerId: owner,
    costCents: input.grams * food.costCents / food.bagGrams,
  });
  await queueStockCheck(food.id, owner);
  return { feeding, grams: input.grams };
});

export const runsOutOn = query({ access: "subscriber" }, async ({ user }, input: { foodId: number }) => {
  if (!Number.isInteger(input.foodId)) throw new HttpError(422, "invalid_input", "foodId must be an integer", "/foodId");
  return await projection(input.foodId, ownerId({ user }));
});

export const costPerMonth = query({ access: "subscriber" }, async ({ db, user }, input: { petId: number }) => {
  if (!Number.isInteger(input.petId)) throw new HttpError(422, "invalid_input", "petId must be an integer", "/petId");
  const owner = ownerId({ user });
  await ownPet(input.petId, owner);
  const now = Date.now();
  const meals = await db.feedings.list({ where: {
    petId: input.petId, ownerId: owner,
    fedAt: { gte: new Date(now - WINDOW_DAYS * DAY_MS).toISOString(), lte: new Date(now).toISOString() },
  } });
  const total = meals.reduce((sum, meal) => sum + meal.costCents, 0);
  return { petId: input.petId, costCents: Math.round(total / WINDOW_DAYS * 30) };
});

export const restockList = mutation({ access: "subscriber" }, async ({ db, user }) => {
  const owner = ownerId({ user });
  const foods = await db.foods.list({ where: { ownerId: owner } });
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
