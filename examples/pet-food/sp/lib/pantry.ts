import { job, type HookCtx } from "spacepress";
import { db, HttpError } from "spacepress/server";
import { shoppingList } from "spacepress/server/db";

export const DAY_MS = 86_400_000;
export const WINDOW_DAYS = 14;
export const RESTOCK_DAYS = 7;

export function ownerId(ctx: HookCtx): number {
  if (!ctx.user || ctx.user.role === "guest") {
    throw new HttpError(401, "unauthenticated", "Sign in with your WordPress account.");
  }
  return ctx.user.id;
}

export async function ownFood(foodId: number, owner: number) {
  const food = await db.query.foods.findFirst({ where: { id: foodId, ownerId: owner } });
  if (!food) throw new HttpError(404, "not_found", "Food not found.");
  return food;
}

export async function ownPet(petId: number, owner: number) {
  const pet = await db.query.pets.findFirst({ where: { id: petId, ownerId: owner } });
  if (!pet) throw new HttpError(404, "not_found", "Pet not found.");
  return pet;
}

export async function usableStock(foodId: number, owner: number, today: string) {
  return await db.query.stock.findMany({
    where: {
      foodId, ownerId: owner, gramsLeft: { gt: 0 },
      OR: [{ expiresOn: { isNull: true } }, { expiresOn: { gte: today } }],
    },
    orderBy: { expiresOn: "asc", id: "asc" },
  });
}

export async function projection(foodId: number, owner: number) {
  const now = Date.now();
  const food = await ownFood(foodId, owner);
  const lots = await usableStock(foodId, owner, new Date(now).toISOString().slice(0, 10));
  const meals = await db.query.feedings.findMany({
    where: { foodId, ownerId: owner, fedAt: {
      gte: new Date(now - WINDOW_DAYS * DAY_MS).toISOString(),
      lte: new Date(now).toISOString(),
    } },
  });
  const gramsLeft = lots.reduce((sum, lot) => sum + lot.gramsLeft, 0);
  const gramsPerDay = meals.reduce((sum, meal) => sum + meal.grams, 0) / WINDOW_DAYS;
  const daysLeft = gramsPerDay > 0 ? gramsLeft / gramsPerDay : null;
  return {
    foodId, product: food.product, gramsLeft, gramsPerDay, daysLeft,
    runsOutOn: gramsLeft === 0 ? new Date(now).toISOString().slice(0, 10)
      : daysLeft === null ? null : new Date(now + daysLeft * DAY_MS).toISOString().slice(0, 10),
    needsRestock: gramsLeft === 0 || (daysLeft !== null && daysLeft <= RESTOCK_DAYS),
  };
}

export const checkLowStock = job({ agents: false, retries: 3 }, async (input: { foodId: number; ownerId: number }) => {
  const food = await db.query.foods.findFirst({ where: { id: input.foodId, ownerId: input.ownerId } });
  if (!food) return;
  const forecast = await projection(food.id, food.ownerId);
  // Scheduler jobs have no user. Update the user's pre-created candidate.
  await db.update(shoppingList).set({ needed: forecast.needsRestock, checkedAt: new Date().toISOString() })
    .where({ foodId: food.id, ownerId: food.ownerId });
});

export async function queueStockCheck(foodId: number, owner: number) {
  await checkLowStock.enqueue({ foodId, ownerId: owner }, { key: `food-${foodId}` });
}
