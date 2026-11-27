import { defineConfig, f, job, mutation, query, table, type InferSelectModel } from "spacepress";
import { HttpError } from "spacepress/server";
import { advanceRenewal, monthlyAmount } from "./sp/lib/calendar";

const ownership = {
  ownerId: f.integer().default(0).access({ create: false, update: false }),
};
export const subscriptions = table({
  ...ownership,
  name: f.text().min(1).max(100),
  vendor: f.text().default("").max(100),
  amount: f.integer().min(0).max(100_000_000),
  currency: f.text().default("USD").pattern(/^[A-Z]{3}$/),
  cycle: f.select(["weekly", "monthly", "yearly"]).default("monthly"),
  nextRenewal: f.date(),
  category: f.text().default("Other").min(1).max(60),
  paymentMethod: f.text().default("").max(100),
  cancelUrl: f.text().default("").max(2000).validate((value) => value === "" || /^https?:\/\//.test(value) ? true : "Use an http or https cancellation URL"),
  notes: f.text({ multiline: true }).default("").max(4000),
  status: f.select(["active", "paused", "cancelled"]).default("active"),
  remindedAt: f.timestamp().access({ create: false, update: false }).optional(),
}, { access: {
  read: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  create: "authenticated",
  update: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  delete: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
} }).on({
  beforeCreate({ data, user }) {
    if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
    data.ownerId = user.id;
    data.name = data.name.trim();
  },
  async beforeUpdate({ patch, existing, db }) {
    patch.ownerId = existing.ownerId;
    if (patch.name !== undefined) patch.name = patch.name.trim();
    if (patch.currency !== undefined && patch.currency !== existing.currency) {
      const charge = await db.system.charges.get({ subscriptionId: existing.id, ownerId: existing.ownerId });
      if (charge) throw new HttpError(409, "currency_has_history", "Keep the currency of recorded charges; create another subscription for a different currency");
    }
    if ((patch.nextRenewal !== undefined && patch.nextRenewal !== existing.nextRenewal)
      || (patch.status === "active" && existing.status !== "active")) patch.remindedAt = null;
  },
  async afterCreate({ row }) { await scheduleReminder(row); },
  async afterUpdate({ row }) { await scheduleReminder(row); },
});

export const charges = table({
  ...ownership,
  subscriptionId: f.ref(subscriptions).onDelete("cascade"),
  amount: f.integer().min(0).max(100_000_000),
  chargedOn: f.date().defaultNow(),
}, { access: {
  read: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  create: "authenticated",
  update: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  delete: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
} }).on({
  async beforeCreate({ data, user, db }) {
    if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
    data.ownerId = user.id;
    const subscription = await db.system.subscriptions.get({ id: data.subscriptionId, ownerId: user.id });
    if (!subscription) throw new HttpError(404, "not_found", "Subscription not found");
  },
  async beforeUpdate({ patch, existing, db }) {
    patch.ownerId = existing.ownerId;
    const subscription = await db.system.subscriptions.get({ id: patch.subscriptionId ?? existing.subscriptionId, ownerId: existing.ownerId });
    if (!subscription) throw new HttpError(404, "not_found", "Subscription not found");
  },
});

export const categories = table({
  ...ownership,
  name: f.text().min(1).max(60),
}, { access: {
  read: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  create: "authenticated",
  update: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
  delete: (ctx) => ctx.user ? { ownerId: ctx.user.id } : false,
} }).on({
  beforeCreate({ data, user }) {
    if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
    data.ownerId = user.id;
    data.name = data.name.trim();
  },
  beforeUpdate({ patch, existing }) {
    patch.ownerId = existing.ownerId;
    if (patch.name !== undefined) patch.name = patch.name.trim();
  },
});
export const tables = { subscriptions, charges, categories };

type Subscription = InferSelectModel<typeof subscriptions>;

async function scheduleReminder(row: Subscription) {
  if (row.status !== "active" || row.remindedAt !== null) return;
  await remindRenewal.enqueue({ subscriptionId: row.id, renewal: row.nextRenewal }, {
    key: `renewal-${row.id}-${row.nextRenewal}`,
    delay: Math.max(0, (new Date(row.nextRenewal).getTime() - Date.now()) / 1000 - 3 * 86_400),
  });
}

export const remindRenewal = job({ retries: 2 }, async ({ db }, { subscriptionId, renewal }: { subscriptionId: number; renewal: string }) => {
  if (!Number.isInteger(subscriptionId)) throw new HttpError(422, "invalid_input", "subscriptionId must be an integer", "/subscriptionId");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(renewal)) throw new HttpError(422, "invalid_input", "renewal must be a date (YYYY-MM-DD)", "/renewal");
  const row = await db.subscriptions.get({ id: subscriptionId, nextRenewal: renewal, status: "active" });
  if (!row || row.remindedAt !== null) return;
  await db.subscriptions.update(row.id, { remindedAt: new Date().toISOString() });
});

export const monthlyBurn = query({ access: "authenticated" }, async ({ db, user }) => {
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
  const rows = await db.subscriptions.list({ where: { ownerId: user.id, status: "active" } });
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
});

export const renewingSoon = query({ access: "authenticated" }, async ({ db, user }, { days = 7 }: { days?: number }) => {
  if (!Number.isInteger(days)) throw new HttpError(422, "invalid_input", "days must be an integer", "/days");
  if (days < 0) throw new HttpError(422, "invalid_input", "days must be at least 0", "/days");
  if (days > 366) throw new HttpError(422, "invalid_input", "days must be at most 366", "/days");
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  return await db.subscriptions.list({
    where: { ownerId: user.id, status: "active", nextRenewal: { gte: today, lte: cutoff } },
    orderBy: { nextRenewal: "asc" },
  });
});

export const logCharge = mutation({ access: "authenticated", idempotent: true }, async ({ db, user, once }, { subscriptionId }: { subscriptionId: number }) => {
  if (!Number.isInteger(subscriptionId)) throw new HttpError(422, "invalid_input", "subscriptionId must be an integer", "/subscriptionId");
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
  const row = await db.system.subscriptions.get({ id: subscriptionId, ownerId: user.id });
  if (!row) throw new HttpError(404, "not_found", "Subscription not found");
  if (row.status !== "active") throw new HttpError(409, "inactive_subscription", "Resume this subscription before logging a charge");
  return await once(`charge-${row.id}-${row.nextRenewal}`, async () => {
    const charge = await db.system.charges.create({ subscriptionId: row.id, amount: row.amount, chargedOn: row.nextRenewal });
    const subscription = await db.system.subscriptions.update(row.id, { nextRenewal: advanceRenewal(row.nextRenewal, row.cycle) });
    return { subscription, charge };
  });
});

export const cancel = mutation({ access: "authenticated" }, async ({ db, user }, { subscriptionId }: { subscriptionId: number }) => {
  if (!Number.isInteger(subscriptionId)) throw new HttpError(422, "invalid_input", "subscriptionId must be an integer", "/subscriptionId");
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
  const row = await db.system.subscriptions.get({ id: subscriptionId, ownerId: user.id });
  if (!row) throw new HttpError(404, "not_found", "Subscription not found");
  const subscription = await db.system.subscriptions.update(row.id, { status: "cancelled" });
  return { subscription, cancelUrl: row.cancelUrl };
});

export default defineConfig({
  name: "subscriptions",
});
