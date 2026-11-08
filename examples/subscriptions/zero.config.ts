import {
  table, text, integer, date, timestamp, defineConfig, defineRelations,
  action, job, jobs, once, db, HttpError, type InferSelectModel,
} from "zero";
import { advanceRenewal, monthlyAmount } from "./zero/lib/calendar";

const ownership = {
  ownerId: integer().notNull().default(0).access({ create: false, update: false }),
};
export const subscriptions = table({
  ...ownership,
  name: text().notNull().min(1).max(100),
  vendor: text().notNull().default("").max(100),
  amount: integer().notNull().min(0).max(100_000_000),
  currency: text().notNull().default("USD").pattern(/^[A-Z]{3}$/),
  cycle: text({ enum: ["weekly", "monthly", "yearly"] }).notNull().default("monthly"),
  nextRenewal: date().notNull(),
  category: text().notNull().default("Other").min(1).max(60),
  paymentMethod: text().notNull().default("").max(100),
  cancelUrl: text().notNull().default("").max(2000).validate((value) => value === "" || /^https?:\/\//.test(value) ? true : "Use an http or https cancellation URL"),
  notes: text({ multiline: true }).notNull().default("").max(4000),
  status: text({ enum: ["active", "paused", "cancelled"] }).notNull().default("active"),
  remindedAt: timestamp().access({ create: false, update: false }),
}, { access: {
  read: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  create: "authenticated",
  update: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  delete: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
} });

export const charges = table({
  ...ownership,
  subscriptionId: integer().notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
  amount: integer().notNull().min(0).max(100_000_000),
  chargedOn: date().notNull().defaultNow(),
}, { access: {
  read: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  create: "authenticated",
  update: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  delete: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
} });

export const categories = table({
  ...ownership,
  name: text().notNull().min(1).max(60),
}, { access: {
  read: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  create: "authenticated",
  update: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  delete: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
} });
export const tables = { subscriptions, charges, categories };
export const relations = defineRelations(tables, (r) => ({
  subscriptions: { charges: r.many.charges() },
  charges: { subscription: r.one.subscriptions({ from: r.charges.subscriptionId, to: r.subscriptions.id }) },
}));

type Subscription = InferSelectModel<typeof subscriptions>;

async function scheduleReminder(row: Subscription) {
  if (row.status !== "active" || row.remindedAt !== null) return;
  await jobs.remindRenewal.enqueue({ subscriptionId: row.id, renewal: row.nextRenewal }, {
    key: `renewal-${row.id}-${row.nextRenewal}`,
    delay: Math.max(0, (new Date(row.nextRenewal).getTime() - Date.now()) / 1000 - 3 * 86_400),
  });
}

export default defineConfig({
  name: "subscriptions",
  tables,
  relations,
  hooks: {
    subscriptions: {
      beforeCreate(data, ctx) {
        const user = ctx.user;
        if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
        data.ownerId = user.id;
        data.name = data.name.trim();
      },
      async beforeUpdate(patch, existing) {
        patch.ownerId = existing.ownerId;
        if (patch.name !== undefined) patch.name = patch.name.trim();
        if (patch.currency !== undefined && patch.currency !== existing.currency) {
          const charge = await db.query.charges.findFirst({ where: { subscriptionId: existing.id, ownerId: existing.ownerId } });
          if (charge) throw new HttpError(409, "currency_has_history", "Keep the currency of recorded charges; create another subscription for a different currency");
        }
        if ((patch.nextRenewal !== undefined && patch.nextRenewal !== existing.nextRenewal)
          || (patch.status === "active" && existing.status !== "active")) patch.remindedAt = null;
      },
      afterCreate: scheduleReminder,
      afterUpdate: scheduleReminder,
    },
    categories: {
      beforeCreate(data, ctx) {
        const user = ctx.user;
        if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
        data.ownerId = user.id;
        data.name = data.name.trim();
      },
      beforeUpdate(patch, existing) {
        patch.ownerId = existing.ownerId;
        if (patch.name !== undefined) patch.name = patch.name.trim();
      },
    },
    charges: {
      async beforeCreate(data, ctx) {
        const user = ctx.user;
        if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
        data.ownerId = user.id;
        const subscription = await db.query.subscriptions.findFirst({ where: { id: data.subscriptionId, ownerId: user.id } });
        if (!subscription) throw new HttpError(404, "not_found", "Subscription not found");
      },
      async beforeUpdate(patch, existing) {
        patch.ownerId = existing.ownerId;
        const subscription = await db.query.subscriptions.findFirst({ where: { id: patch.subscriptionId ?? existing.subscriptionId, ownerId: existing.ownerId } });
        if (!subscription) throw new HttpError(404, "not_found", "Subscription not found");
      },
    },
  },
  jobs: {
    remindRenewal: job({
      input: { subscriptionId: integer().notNull(), renewal: date().notNull() },
      retries: 2,
      async handler({ subscriptionId, renewal }) {
        const row = await db.query.subscriptions.findFirst({ where: { id: subscriptionId, nextRenewal: renewal, status: "active" } });
        if (!row || row.remindedAt !== null) return;
        await db.update(subscriptions).set({ remindedAt: new Date().toISOString() }).where({ id: row.id, ownerId: row.ownerId, nextRenewal: renewal });
      },
    }),
  },
  actions: {
    monthlyBurn: action({
      input: {}, access: "authenticated",
      async handler(_input, ctx) {
        const user = ctx.user;
        if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
        const rows = await db.query.subscriptions.findMany({ where: { ownerId: user.id, status: "active" } });
        const currencies: { currency: string; amount: number; categories: { category: string; amount: number }[] }[] = [];
        for (const row of rows) {
          let total = currencies.find((entry) => entry.currency === row.currency);
          if (!total) {
            total = { currency: row.currency, amount: 0, categories: [] };
            currencies.push(total);
          }
          const amount = monthlyAmount(row.amount, row.cycle);
          total.amount += amount;
          let category = total.categories.find((entry) => entry.category === row.category);
          if (!category) {
            category = { category: row.category, amount: 0 };
            total.categories.push(category);
          }
          category.amount += amount;
        }
        return { currencies: currencies.map((total) => ({
          currency: total.currency, amount: Math.round(total.amount),
          categories: total.categories.map((category) => ({ category: category.category, amount: Math.round(category.amount) })),
        })) };
      },
    }),
    renewingSoon: action({
      input: { days: integer().notNull().default(7).min(0).max(366) }, access: "authenticated",
      async handler({ days }, ctx) {
        const user = ctx.user;
        if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
        const today = new Date().toISOString().slice(0, 10);
        const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
        return await db.query.subscriptions.findMany({
          where: { ownerId: user.id, status: "active", nextRenewal: { gte: today, lte: cutoff } },
          orderBy: { nextRenewal: "asc" },
        });
      },
    }),
    logCharge: action({
      input: { subscriptionId: integer().notNull() }, access: "authenticated", idempotent: true,
      async handler({ subscriptionId }, ctx) {
        const user = ctx.user;
        if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
        const row = await db.query.subscriptions.findFirst({ where: { id: subscriptionId, ownerId: user.id } });
        if (!row) throw new HttpError(404, "not_found", "Subscription not found");
        if (row.status !== "active") throw new HttpError(409, "inactive_subscription", "Resume this subscription before logging a charge");
        return await once(`charge-${row.id}-${row.nextRenewal}`, async () => {
          const [charge] = await db.insert(charges).values({ subscriptionId: row.id, amount: row.amount, chargedOn: row.nextRenewal }).returning();
          const [subscription] = await db.update(subscriptions).set({ nextRenewal: advanceRenewal(row.nextRenewal, row.cycle) }).where({ id: row.id, ownerId: user.id }).returning();
          return { subscription, charge };
        });
      },
    }),
    cancel: action({
      input: { subscriptionId: integer().notNull() }, access: "authenticated",
      async handler({ subscriptionId }, ctx) {
        const user = ctx.user;
        if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
        const row = await db.query.subscriptions.findFirst({ where: { id: subscriptionId, ownerId: user.id } });
        if (!row) throw new HttpError(404, "not_found", "Subscription not found");
        const [subscription] = await db.update(subscriptions).set({ status: "cancelled" }).where({ id: row.id, ownerId: user.id }).returning();
        return { subscription, cancelUrl: row.cancelUrl };
      },
    }),
  },
});
