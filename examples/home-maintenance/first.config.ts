import {
  action, collection, date, db, defineConfig, file, files,
  HttpError, integer, job, jobs, media, richText, text, timestamp,
  type InferSelectModel, select, ref,
} from "first";
import { addDays, overdueDelay, today } from "./first/lib/dates";

const owner = integer().access({ create: false, update: false }).ui({ label: "Owner", help: "Set automatically from your WordPress account." });

export const systems = collection({
  name: text().min(1).max(120),
  ownerId: owner,
  room: text().min(1).max(80),
  kind: select(["hvac", "plumbing", "electrical", "appliance", "safety"]),
  make: text().max(120).optional(),
  model: text().max(120).optional(),
  installedOn: date().optional(),
  manual: file({ bucket: "manuals" }).ui({
    label: "Manual PDF", help: "Upload to /__first/api/v1/files/manuals, then enter its file ID.",
  }).optional(),
}, { title: "name", label: "Home systems", access: {
  read: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), create: "authenticated",
  update: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), delete: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }),
} });

export const tasks = collection({
  title: text().min(1).max(160),
  ownerId: owner,
  systemId: ref(systems),
  everyDays: integer().min(1).max(36500).default(90).ui({ label: "Repeat every days", help: "The next date is calculated in UTC when you mark this task done." }),
  lastDoneOn: date().optional(),
  nextDueOn: date().defaultNow(),
  instructions: richText().optional(),
  overdueAt: timestamp().access({ create: false, update: false }).ui({ label: "Overdue since", help: "Stamped by Action Scheduler after the due day ends in UTC." }).optional(),
}, { title: "title", content: "instructions", label: "Maintenance tasks", access: {
  read: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), create: "authenticated",
  update: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), delete: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }),
} });

export const doneLogs = collection({
  title: text().default("Maintenance completed"),
  ownerId: owner,
  taskId: ref(tasks),
  systemId: ref(systems).access({ create: false, update: false }).ui({ help: "The system maintained when this work was logged, preserved for yearly costs." }),
  doneOn: date().defaultNow(),
  notes: text({ multiline: true }).max(10000).optional(),
  costCents: integer().min(0).max(100000000).default(0),
  photo: media({ accept: "image" }).optional(),
}, { title: "title", label: "Work done", access: {
  read: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), create: "authenticated",
  update: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }), delete: (ctx) => ({ ownerId: ctx.user?.id ?? -1 }),
} });

const collections = { systems, tasks, doneLogs };

async function requireSystem(systemId: number, userId: number) {
  const system = await db.query.systems.findFirst({ where: { id: systemId, ownerId: userId } });
  if (!system) throw new HttpError(404, "not_found", "Home system not found");
  return system;
}

async function requireTask(taskId: number, userId: number) {
  const task = await db.query.tasks.findFirst({ where: { id: taskId, ownerId: userId } });
  if (!task) throw new HttpError(404, "not_found", "Maintenance task not found");
  return task;
}

async function scheduleOverdue(task: InferSelectModel<typeof tasks>) {
  await jobs.flagOverdue.enqueue({ taskId: task.id, ownerId: task.ownerId, dueOn: task.nextDueOn }, {
    delay: overdueDelay(task.nextDueOn), key: `overdue-${task.id}-${task.nextDueOn}`,
  });
}

export default defineConfig({
  name: "home-maintenance",
  admin: true,
  collections,
  files: {
    manuals: files("manuals", {
      accept: ["application/pdf"], maxBytes: 20_000_000,
      access: { read: "owner", delete: "owner" },
    }),
  },
  hooks: {
    systems: {
      beforeCreate(data, ctx) {
        if (!ctx.user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
        data.ownerId = ctx.user.id;
        data.name = data.name.trim();
        data.room = data.room.trim();
      },
      beforeUpdate(patch, existing) {
        patch.ownerId = existing.ownerId;
        if (patch.name !== undefined) patch.name = patch.name.trim();
        if (patch.room !== undefined) patch.room = patch.room.trim();
      },
    },
    tasks: {
      async beforeCreate(data, ctx) {
        if (!ctx.user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
        data.ownerId = ctx.user.id;
        await requireSystem(data.systemId, data.ownerId);
        data.title = data.title.trim();
        data.overdueAt = null;
      },
      async beforeUpdate(patch, existing) {
        patch.ownerId = existing.ownerId;
        if (patch.systemId !== undefined) await requireSystem(patch.systemId, existing.ownerId);
        if (patch.title !== undefined) patch.title = patch.title.trim();
        if (patch.nextDueOn !== undefined && patch.nextDueOn !== existing.nextDueOn) patch.overdueAt = null;
      },
      afterCreate: scheduleOverdue,
      async afterUpdate(row, previous) {
        if (row.nextDueOn !== previous.nextDueOn) await scheduleOverdue(row);
      },
    },
    doneLogs: {
      async beforeCreate(data, ctx) {
        if (!ctx.user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
        data.ownerId = ctx.user.id;
        const task = await requireTask(data.taskId, data.ownerId);
        data.systemId = task.systemId;
        data.title = task.title + " on " + data.doneOn;
      },
      async beforeUpdate(patch, existing) {
        patch.ownerId = existing.ownerId;
        if (patch.taskId !== undefined && patch.taskId !== existing.taskId) {
          throw new HttpError(422, "invalid_input", "A work log stays with its original task");
        }
        patch.systemId = existing.systemId;
        const task = await requireTask(patch.taskId ?? existing.taskId, existing.ownerId);
        patch.title = task.title + " on " + (patch.doneOn ?? existing.doneOn);
      },
    },
  },
  actions: {
    dueNext: action({
      input: { days: integer().min(0).max(366).default(30) },
      access: "authenticated",
      async handler({ days }, ctx) {
        if (!ctx.user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
        const userId = ctx.user.id;
        const through = addDays(today(), days);
        const due = await db.query.tasks.findMany({
          where: { ownerId: userId, nextDueOn: { lte: through } },
          orderBy: { nextDueOn: "asc" },
        });
        return { through, tasks: due };
      },
    }),
    markDone: action({
      input: {
        taskId: integer(), notes: text().max(10000).optional(),
        costCents: integer().min(0).max(100000000).optional(),
      },
      access: "authenticated",
      idempotent: true,
      async handler({ taskId, notes, costCents }, ctx) {
        if (!ctx.user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
        const userId = ctx.user.id;
        const task = await requireTask(taskId, userId);
        const doneOn = today();
        const [log] = await db.insert(doneLogs).values({
          taskId, ownerId: userId, systemId: task.systemId,
          doneOn, notes: notes ?? "", costCents: costCents ?? 0,
        }).returning();
        const [updated] = await db.update(tasks).set({
          lastDoneOn: doneOn, nextDueOn: addDays(doneOn, task.everyDays), overdueAt: null,
        }).where({ id: taskId, ownerId: userId }).returning();
        return { log, task: updated };
      },
    }),
    yearCost: action({
      input: { year: integer().min(1900).max(9998) },
      access: "authenticated",
      async handler({ year }, ctx) {
        if (!ctx.user) throw new HttpError(401, "unauthenticated", "Sign in to maintain your home");
        const userId = ctx.user.id;
        const homeSystems = await db.query.systems.findMany({ where: { ownerId: userId }, orderBy: { name: "asc" } });
        const logs = await db.query.doneLogs.findMany({
          where: { ownerId: userId, doneOn: { gte: `${year}-01-01`, lt: `${year + 1}-01-01` } },
        });
        const spend = homeSystems.map((system) => {
          const costs = logs.filter((log) => log.systemId === system.id);
          return { systemId: system.id, name: system.name, costCents: costs.reduce((sum, log) => sum + log.costCents, 0) };
        });
        return { year, systems: spend, totalCents: spend.reduce((sum, system) => sum + system.costCents, 0) };
      },
    }),
  },
  jobs: {
    flagOverdue: job({
      input: { taskId: integer(), ownerId: integer(), dueOn: date() },
      retries: 3,
      async handler({ taskId, ownerId: userId, dueOn }) {
        const task = await db.query.tasks.findFirst({ where: { id: taskId, ownerId: userId } });
        if (!task) return;
        if (task.nextDueOn !== dueOn || task.nextDueOn >= today() || task.overdueAt !== null) return;
        await db.update(tasks).set({ overdueAt: new Date().toISOString() })
          .where({ id: taskId, ownerId: userId, nextDueOn: dueOn, overdueAt: { isNull: true } });
      },
    }),
  },
});
