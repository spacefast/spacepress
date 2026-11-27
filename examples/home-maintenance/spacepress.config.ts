import { collection, defineConfig, f, files, job, mutation, query, type InferSelectModel } from "spacepress";
import { db, HttpError } from "spacepress/server";
import { addDays, overdueDelay, today } from "./sp/lib/dates";

const owner = f.integer().access({ create: false, update: false }).ui({ label: "Owner", help: "Set automatically from your WordPress account." });

export const manuals = files({
  accept: ["application/pdf"], maxBytes: 20_000_000,
  access: { read: "owner", delete: "owner" },
});

export const systems = collection({
  name: f.text().min(1).max(120),
  ownerId: owner,
  room: f.text().min(1).max(80),
  kind: f.select(["hvac", "plumbing", "electrical", "appliance", "safety"]),
  make: f.text().max(120).optional(),
  model: f.text().max(120).optional(),
  installedOn: f.date().optional(),
  manual: f.file(manuals).ui({
    label: "Manual PDF", help: "Upload to /wp-json/spacepress/v1/files/manuals, then enter its file ID.",
  }).optional(),
}, { title: "name", label: "Home systems", access: {
  read: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), create: "authenticated",
  update: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), delete: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }),
} }).on({
  beforeCreate({ data, user }) {
    if (!user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
    data.ownerId = user.id;
    data.name = data.name.trim();
    data.room = data.room.trim();
  },
  beforeUpdate({ patch, existing }) {
    patch.ownerId = existing.ownerId;
    if (patch.name !== undefined) patch.name = patch.name.trim();
    if (patch.room !== undefined) patch.room = patch.room.trim();
  },
});

export const tasks = collection({
  title: f.text().min(1).max(160),
  ownerId: owner,
  systemId: f.ref(systems),
  everyDays: f.integer().min(1).max(36500).default(90).ui({ label: "Repeat every days", help: "The next date is calculated in UTC when you mark this task done." }),
  lastDoneOn: f.date().optional(),
  nextDueOn: f.date().defaultNow(),
  instructions: f.richText().optional(),
  overdueAt: f.timestamp().access({ create: false, update: false }).ui({ label: "Overdue since", help: "Stamped by Action Scheduler after the due day ends in UTC." }).optional(),
}, { title: "title", content: "instructions", label: "Maintenance tasks", access: {
  read: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), create: "authenticated",
  update: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), delete: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }),
} }).on({
  async beforeCreate({ data, user }) {
    if (!user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
    data.ownerId = user.id;
    await requireSystem(data.systemId, data.ownerId);
    data.title = data.title.trim();
    data.overdueAt = null;
  },
  async beforeUpdate({ patch, existing }) {
    patch.ownerId = existing.ownerId;
    if (patch.systemId !== undefined) await requireSystem(patch.systemId, existing.ownerId);
    if (patch.title !== undefined) patch.title = patch.title.trim();
    if (patch.nextDueOn !== undefined && patch.nextDueOn !== existing.nextDueOn) patch.overdueAt = null;
  },
  async afterCreate({ row }) { await scheduleOverdue(row); },
  async afterUpdate({ row, previous }) {
    if (row.nextDueOn !== previous.nextDueOn) await scheduleOverdue(row);
  },
});

export const doneLogs = collection({
  title: f.text().default("Maintenance completed"),
  ownerId: owner,
  taskId: f.ref(tasks),
  systemId: f.ref(systems).access({ create: false, update: false }).ui({ help: "The system maintained when this work was logged, preserved for yearly costs." }),
  doneOn: f.date().defaultNow(),
  notes: f.text({ multiline: true }).max(10000).optional(),
  costCents: f.integer().min(0).max(100000000).default(0),
  photo: f.media({ accept: "image" }).optional(),
}, { title: "title", label: "Work done", access: {
  read: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), create: "authenticated",
  update: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), delete: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }),
} }).on({
  async beforeCreate({ data, user }) {
    if (!user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
    data.ownerId = user.id;
    const task = await requireTask(data.taskId, data.ownerId);
    data.systemId = task.systemId;
    data.title = task.title + " on " + data.doneOn;
  },
  async beforeUpdate({ patch, existing }) {
    patch.ownerId = existing.ownerId;
    if (patch.taskId !== undefined && patch.taskId !== existing.taskId) {
      throw new HttpError(422, "invalid_input", "A work log stays with its original task");
    }
    patch.systemId = existing.systemId;
    const task = await requireTask(patch.taskId ?? existing.taskId, existing.ownerId);
    patch.title = task.title + " on " + (patch.doneOn ?? existing.doneOn);
  },
});

const collections = { systems, tasks, doneLogs };
void collections;

async function requireSystem(systemId: number, userId: number) {
  const system = await db.system.systems.get({ id: systemId, ownerId: userId });
  if (!system) throw new HttpError(404, "not_found", "Home system not found");
  return system;
}

async function requireTask(taskId: number, userId: number) {
  const task = await db.system.tasks.get({ id: taskId, ownerId: userId });
  if (!task) throw new HttpError(404, "not_found", "Maintenance task not found");
  return task;
}

async function scheduleOverdue(task: InferSelectModel<typeof tasks>) {
  await flagOverdue.enqueue({ taskId: task.id, ownerId: task.ownerId, dueOn: task.nextDueOn }, {
    delay: overdueDelay(task.nextDueOn), key: `overdue-${task.id}-${task.nextDueOn}`,
  });
}

export const dueNext = query({ access: "authenticated" }, async ({ db, user }, { days = 30 }: { days?: number }) => {
  if (!Number.isInteger(days)) throw new HttpError(422, "invalid_input", "days must be an integer", "/days");
  if (days < 0) throw new HttpError(422, "invalid_input", "days must be at least 0", "/days");
  if (days > 366) throw new HttpError(422, "invalid_input", "days must be at most 366", "/days");
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
  const userId = user.id;
  const through = addDays(today(), days);
  const due = await db.tasks.list({
    where: { ownerId: userId, nextDueOn: { lte: through } },
    orderBy: { nextDueOn: "asc" },
  });
  return { through, tasks: due };
});

export const markDone = mutation({ access: "authenticated", idempotent: true }, async ({ db, user }, { taskId, notes, costCents }: { taskId: number; notes?: string; costCents?: number }) => {
  if (!Number.isInteger(taskId)) throw new HttpError(422, "invalid_input", "taskId must be an integer", "/taskId");
  if (costCents !== undefined && !Number.isInteger(costCents)) throw new HttpError(422, "invalid_input", "costCents must be an integer", "/costCents");
  if (notes !== undefined && notes.length > 10000) throw new HttpError(422, "invalid_input", "notes must be at most 10000 characters", "/notes");
  if (costCents !== undefined && costCents < 0) throw new HttpError(422, "invalid_input", "costCents must be at least 0", "/costCents");
  if (costCents !== undefined && costCents > 100000000) throw new HttpError(422, "invalid_input", "costCents must be at most 100000000", "/costCents");
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
  const userId = user.id;
  const task = await requireTask(taskId, userId);
  const doneOn = today();
  const log = await db.system.doneLogs.create({
    taskId, ownerId: userId, systemId: task.systemId,
    doneOn, notes: notes ?? "", costCents: costCents ?? 0,
  });
  const updated = await db.system.tasks.update(taskId, {
    lastDoneOn: doneOn, nextDueOn: addDays(doneOn, task.everyDays), overdueAt: null,
  });
  return { log, task: updated };
});

export const yearCost = query({ access: "authenticated" }, async ({ db, user }, { year }: { year: number }) => {
  if (!Number.isInteger(year)) throw new HttpError(422, "invalid_input", "year must be an integer", "/year");
  if (year < 1900) throw new HttpError(422, "invalid_input", "year must be at least 1900", "/year");
  if (year > 9998) throw new HttpError(422, "invalid_input", "year must be at most 9998", "/year");
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
  const userId = user.id;
  const homeSystems = await db.systems.list({ where: { ownerId: userId }, orderBy: { name: "asc" } });
  const logs = await db.doneLogs.list({
    where: { ownerId: userId, doneOn: { gte: `${year}-01-01`, lt: `${year + 1}-01-01` } },
  });
  const spend = homeSystems.map((system) => {
    const costs = logs.filter((log) => log.systemId === system.id);
    return { systemId: system.id, name: system.name, costCents: costs.reduce((sum, log) => sum + log.costCents, 0) };
  });
  return { year, systems: spend, totalCents: spend.reduce((sum, system) => sum + system.costCents, 0) };
});

export const flagOverdue = job({ retries: 3 }, async ({ db }, { taskId, ownerId: userId, dueOn }: { taskId: number; ownerId: number; dueOn: string }) => {
  if (!Number.isInteger(taskId)) throw new HttpError(422, "invalid_input", "taskId must be an integer", "/taskId");
  if (!Number.isInteger(userId)) throw new HttpError(422, "invalid_input", "ownerId must be an integer", "/ownerId");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new HttpError(422, "invalid_input", "dueOn must be a date (YYYY-MM-DD)", "/dueOn");
  const task = await db.tasks.get({ id: taskId, ownerId: userId });
  if (!task) return;
  if (task.nextDueOn !== dueOn || task.nextDueOn >= today() || task.overdueAt !== null) return;
  await db.tasks.update(task.id, { overdueAt: new Date().toISOString() });
});

export default defineConfig({
  name: "home-maintenance",
});
