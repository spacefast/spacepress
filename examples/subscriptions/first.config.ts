import {
  table, text, integer, date, timestamp, defineConfig, action, job, jobs, once, db, HttpError, type InferSelectModel, select, ref,
} from "first";
import { advanceRenewal, monthlyAmount } from "./first/lib/calendar";

const ownership = {
  ownerId: integer().default(0).access({ create: false, update: false }),
};
export const subscriptions = table({
  ...ownership,
  name: text().min(1).max(100),
  vendor: text().default("").max(100),
  amount: integer().min(0).max(100_000_000),
  currency: text().default("USD").pattern(/^[A-Z]{3}$/),
  cycle: select(["weekly", "monthly", "yearly"]).default("monthly"),
  nextRenewal: date(),
  category: text().default("Other").min(1).max(60),
  paymentMethod: text().default("").max(100),
  cancelUrl: text().default("").max(2000).validate((value) => value === "" || /^https?:\/\//.test(value) ? true : "Use an http or https cancellation URL"),
  notes: text({ multiline: true }).default("").max(4000),
  status: select(["active", "paused", "cancelled"]).default("active"),
  remindedAt: timestamp().access({ create: false, update: false }).optional(),
}, { access: {
  read: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  create: "authenticated",
  update: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  delete: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
} }).on({
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
});

export const charges = table({
  ...ownership,
  subscriptionId: ref(subscriptions).onDelete("cascade"),
  amount: integer().min(0).max(100_000_000),
  chargedOn: date().defaultNow(),
}, { access: {
  read: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  create: "authenticated",
  update: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  delete: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
} }).on({
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
});

export const categories = table({
  ...ownership,
  name: text().min(1).max(60),
}, { access: {
  read: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  create: "authenticated",
  update: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  delete: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
} }).on({
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
});
export const tables = { subscriptions, charges, categories };

type Subscription = InferSelectModel<typeof subscriptions>;

async function scheduleReminder(row: Subscription) {
  if (row.status !== "active" || row.remindedAt !== null) return;
  await jobs.remindRenewal.enqueue({ subscriptionId: row.id, renewal: row.nextRenewal }, {
    key: `renewal-${row.id}-${row.nextRenewal}`,
    delay: Math.max(0, (new Date(row.nextRenewal).getTime() - Date.now()) / 1000 - 3 * 86_400),
  });
}

export const remindRenewal = job({
  input: { subscriptionId: integer(), renewal: date() },
  retries: 2,
  async handler({ subscriptionId, renewal }) {
    const row = await db.query.subscriptions.findFirst({ where: { id: subscriptionId, nextRenewal: renewal, status: "active" } });
    if (!row || row.remindedAt !== null) return;
    await db.update(subscriptions).set({ remindedAt: new Date().toISOString() }).where({ id: row.id, ownerId: row.ownerId, nextRenewal: renewal });
  },
});

export const monthlyBurn = action({
  input: {}, access: "authenticated",
  async handler(_input, ctx) {
    const user = ctx.user;
    if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
    const rows = await db.query.subscriptions.findMany({ where: { ownerId: user.id, status: "active" } });
    // Totals by currency, then by category: a running sum per key, kept as a list to keep order.
    const currencies: { currency: string; amount: number; categories: { category: string; amount: number }[] }[] = [];
    for (const row of rows) {
      const amount = monthlyAmount(row.amount, row.cycle);
      const found = currencies.findIndex((entry) => entry.currency === row.currency);
      const at = found >= 0 ? found : currencies.push({ currency: row.currency, amount: 0, categories: [] }) - 1;
      const total = currencies[at]!;
      total.amount += amount;
      const index = total.categories.findIndex((entry) => entry.category === row.category);
      if (index >= 0) total.categories[index]!.amount += amount;
      else total.categories.push({ category: row.category, amount });
    }
    return { currencies: currencies.map((total) => ({
      currency: total.currency, amount: Math.round(total.amount),
      categories: total.categories.map((category) => ({ category: category.category, amount: Math.round(category.amount) })),
    })) };
  },
});

export const renewingSoon = action({
  input: { days: integer().default(7).min(0).max(366) }, access: "authenticated",
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
});

export const logCharge = action({
  input: { subscriptionId: integer() }, access: "authenticated", idempotent: true,
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
});

export const cancel = action({
  input: { subscriptionId: integer() }, access: "authenticated",
  async handler({ subscriptionId }, ctx) {
    const user = ctx.user;
    if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
    const row = await db.query.subscriptions.findFirst({ where: { id: subscriptionId, ownerId: user.id } });
    if (!row) throw new HttpError(404, "not_found", "Subscription not found");
    const [subscription] = await db.update(subscriptions).set({ status: "cancelled" }).where({ id: row.id, ownerId: user.id }).returning();
    return { subscription, cancelUrl: row.cancelUrl };
  },
});

export default defineConfig({
  name: "subscriptions",
});
