import { action, db, defineConfig, HttpError, integer, job, timestamp, number } from "first";
import { collections, tables, feedings, stock, shoppingList } from "./first/lib/schema";
import { DAY_MS, WINDOW_DAYS, ownerId, ownFood, ownPet, projection, queueStockCheck, usableStock } from "./first/lib/pantry";

export default defineConfig({
  name: "pet-food",
  collections,
  tables,
  hooks: {
    pets: {
      beforeCreate(data, ctx) { data.ownerId = ownerId(ctx); data.name = data.name.trim(); },
      beforeUpdate(patch, existing) { patch.ownerId = existing.ownerId; },
    },
    foods: {
      beforeCreate(data, ctx) { data.ownerId = ownerId(ctx); data.product = data.product.trim(); },
      beforeUpdate(patch, existing) { patch.ownerId = existing.ownerId; },
      async afterCreate(row) {
        // Create the owned candidate while the signed-in user's actor is available.
        await db.insert(shoppingList).values({ foodId: row.id, ownerId: row.ownerId });
        await queueStockCheck(row.id, row.ownerId);
      },
    },
    vetNotes: {
      async beforeCreate(data, ctx) {
        data.ownerId = ownerId(ctx);
        await ownPet(data.petId, data.ownerId);
      },
      async beforeUpdate(patch, existing) {
        patch.ownerId = existing.ownerId;
        await ownPet(patch.petId ?? existing.petId, existing.ownerId);
      },
    },
    stock: {
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
    },
    feedings: {
      async beforeCreate(data, ctx) {
        data.ownerId = ownerId(ctx);
        await ownPet(data.petId, data.ownerId);
        await ownFood(data.foodId, data.ownerId);
      },
    },
    shoppingList: {
      async beforeCreate(data, ctx) {
        data.ownerId = ownerId(ctx);
        await ownFood(data.foodId, data.ownerId);
      },
      beforeUpdate(patch, existing) { patch.ownerId = existing.ownerId; },
    },
  },
  jobs: {
    checkLowStock: job({
      input: { foodId: integer(), ownerId: integer() },
      agents: false,
      retries: 3,
      async handler(input) {
        const food = await db.query.foods.findFirst({ where: { id: input.foodId, ownerId: input.ownerId } });
        if (!food) return;
        const forecast = await projection(food.id, food.ownerId);
        // Scheduler jobs have no user. Update the user's pre-created candidate.
        await db.update(shoppingList).set({ needed: forecast.needsRestock, checkedAt: new Date().toISOString() })
          .where({ foodId: food.id, ownerId: food.ownerId });
      },
    }),
  },
  actions: {
    feed: action({
      access: "subscriber",
      idempotent: true,
      input: {
        petId: integer(), foodId: integer(),
        grams: number().min(0.01), fedAt: timestamp().optional(),
      },
      async handler(input, ctx) {
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
      },
    }),
    runsOutOn: action({
      access: "subscriber",
      input: { foodId: integer() },
      async handler(input, ctx) { return await projection(input.foodId, ownerId(ctx)); },
    }),
    costPerMonth: action({
      access: "subscriber",
      input: { petId: integer() },
      async handler(input, ctx) {
        const owner = ownerId(ctx);
        await ownPet(input.petId, owner);
        const now = Date.now();
        const meals = await db.query.feedings.findMany({ where: {
          petId: input.petId, ownerId: owner,
          fedAt: { gte: new Date(now - WINDOW_DAYS * DAY_MS).toISOString(), lte: new Date(now).toISOString() },
        } });
        const total = meals.reduce((sum, meal) => sum + meal.costCents, 0);
        return { petId: input.petId, costCents: Math.round(total / WINDOW_DAYS * 30) };
      },
    }),
    restockList: action({
      access: "subscriber",
      input: {},
      async handler(input, ctx) {
        const owner = ownerId(ctx);
        const foods = await db.query.foods.findMany({ where: { ownerId: owner } });
        const result = [];
        for (const food of foods) {
          const forecast = await projection(food.id, owner);
          if (forecast.needsRestock) result.push(forecast);
          await queueStockCheck(food.id, owner);
        }
        return result;
      },
    }),
  },
});
