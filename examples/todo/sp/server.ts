import {
  adminDashboard,
  adminScreen,
  adminWidget,
  cron,
  HttpError,
  item,
  job,
  mutation,
  query,
} from "spacepress";
import { buckets, tasks } from "spacepress:db";
import {
  appendBucketUnique,
  asBucketKind,
  asOptionalStatusSlug,
  asPriority,
  asStatusSlug,
  computeNextOccurrenceIso,
  computeScheduleDelaySeconds,
  computeSnoozeIso,
  computeTodoViewCounts,
  decodeWpText,
  findBucketBySlug,
  normalizeOptionalText,
  normalizeOptionalUrl,
  normalizeTaskTitle,
  parseDateInputToIso,
  removeBucketId,
  replaceStatusBucket,
  statusBucketIds,
  type TodoBucket,
  type TodoStatusSlug,
  type TodoTask,
} from "./lib/todo";

async function loadBuckets(): Promise<TodoBucket[]> {
  const rows = await buckets.system.list({ orderBy: { sortOrder: "asc" }, limit: 200 });
  return rows.map((row) => ({
    id: row.id,
    name: decodeWpText(row.name),
    slug: row.slug,
    parent: row.parent ?? 0,
    kind: asBucketKind(row.kind) ?? "project",
    color: row.color ?? null,
    sortOrder: row.sortOrder,
  }));
}

function parseOptionalInt(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

function parseBucketCsv(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const id = Number.parseInt(trimmed, 10);
    if (Number.isInteger(id) && id > 0 && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

// Runs via Action Scheduler when a task's scheduledAt arrives (delayed enqueue).
export const promoteScheduledTask = job({ retries: 3 }, async ({ taskId }: { taskId: number }) => {
  if (!Number.isInteger(taskId) || taskId <= 0) return;
  const task = await tasks.system.get(taskId);
  if (!task || task.completedAt !== null || task.scheduledAt === null) return;
  if (new Date(task.scheduledAt).getTime() > Date.now() + 60_000) return;

  const allBuckets = await loadBuckets();
  const targetSlug: TodoStatusSlug = asStatusSlug(task.pendingBucket, "now");
  const targetBucket = findBucketBySlug(allBuckets, targetSlug);
  const nextBucketIds = targetBucket
    ? replaceStatusBucket(task.bucketIds, statusBucketIds(allBuckets), targetBucket.id)
    : task.bucketIds;

  await tasks.system.update(task.id, {
    bucketIds: nextBucketIds,
    scheduledAt: null,
  });
});

// Safety-net sweep every 15 minutes for any scheduled task whose due time passed.
export const sweepScheduledTasks = cron("*/15 * * * *", async () => {
  const nowIso = new Date().toISOString();
  const open = await tasks.system.list({
    where: { completedAt: { isNull: true }, scheduledAt: { isNotNull: true } },
    limit: 200,
  });
  for (const task of open) {
    if (task.scheduledAt && task.scheduledAt <= nowIso) {
      await promoteScheduledTask.enqueue({ taskId: task.id }, { key: `promote-task-${task.id}` });
    }
  }
});

async function enqueueScheduleIfNeeded(taskId: number, scheduledAt: string | null): Promise<void> {
  if (!scheduledAt) return;
  const delay = computeScheduleDelaySeconds(scheduledAt, Date.now());
  await promoteScheduledTask.enqueue(
    { taskId },
    { delay, key: `promote-task-${taskId}-${scheduledAt.slice(0, 10)}` },
  );
}

async function runCompletionSideEffects(
  completedId: number,
  allowRecurrence: boolean,
): Promise<{ nextTaskId: number | null; unblockedIds: number[] }> {
  const task = await tasks.get(completedId);
  if (!task) throw new HttpError(404, "not_found", "Task not found.");

  const nowIso = new Date().toISOString();
  const allBuckets = await loadBuckets();
  const statusIds = statusBucketIds(allBuckets);

  await tasks.update(task.id, {
    completedAt: nowIso,
    scheduledAt: null,
    recurringDays: allowRecurrence ? task.recurringDays : 0,
  });

  // 1. Spawn the next recurring occurrence when configured (kept out of its active target status until due).
  let nextTaskId: number | null = null;
  if (allowRecurrence && task.recurringDays > 0) {
    const destSlug = asStatusSlug(task.pendingBucket, "now");
    const destBucket = findBucketBySlug(allBuckets, destSlug);
    const laterBucket = findBucketBySlug(allBuckets, "later");
    let nextBuckets = destBucket ? removeBucketId(task.bucketIds, destBucket.id) : [...task.bucketIds];
    if (laterBucket) {
      nextBuckets = replaceStatusBucket(nextBuckets, statusIds, laterBucket.id);
    }
    const nextScheduledAt = computeNextOccurrenceIso(nowIso, task.recurringDays);
    const created = await tasks.create({
      title: task.title,
      notes: task.notes,
      details: task.details,
      url: task.url,
      priority: task.priority,
      bucketIds: nextBuckets,
      scheduledAt: nextScheduledAt,
      pendingBucket: destSlug,
      recurringDays: task.recurringDays,
      status: "published",
    });
    nextTaskId = created.id;
    await enqueueScheduleIfNeeded(created.id, nextScheduledAt);
  }

  // 2. Release any open tasks blocked by this task and promote them to their pending destination.
  const waiting = await tasks.list({
    where: { blockedBy: task.id, completedAt: { isNull: true } },
    limit: 100,
  });
  const unblockedIds: number[] = [];
  for (const dep of waiting) {
    const destSlug = asStatusSlug(dep.pendingBucket, "now");
    const destBucket = findBucketBySlug(allBuckets, destSlug);
    const nextBucketIds = destBucket
      ? replaceStatusBucket(dep.bucketIds, statusIds, destBucket.id)
      : dep.bucketIds;
    await tasks.update(dep.id, {
      blockedBy: null,
      bucketIds: nextBucketIds,
    });
    unblockedIds.push(dep.id);
  }

  return { nextTaskId, unblockedIds };
}

export const createTask = mutation(
  { access: "authenticated" },
  async (input: {
    title: string;
    notes?: string;
    url?: string;
    priority?: string;
    statusBucket?: string;
    paraBucketId?: string | number;
    scheduledDate?: string;
    recurringDays?: string | number;
  }) => {
    const title = normalizeTaskTitle(input.title ?? "");
    if (title === "") {
      throw new HttpError(422, "invalid_input", "Enter a task title.", "/title");
    }
    if (title.length > 240) {
      throw new HttpError(422, "invalid_input", "Title must be at most 240 characters.", "/title");
    }

    const rawUrl = normalizeOptionalText(input.url);
    const cleanUrl = normalizeOptionalUrl(rawUrl);
    if (rawUrl !== null && cleanUrl === null) {
      throw new HttpError(422, "invalid_input", "Action URL must start with http:// or https://.", "/url");
    }

    const priority = asPriority(input.priority, "none");
    const statusSlug = asStatusSlug(input.statusBucket, "inbox");
    const scheduledAt = parseDateInputToIso(input.scheduledDate);
    const recurring = parseOptionalInt(input.recurringDays) ?? 0;
    if (recurring < 0 || recurring > 3650) {
      throw new HttpError(422, "invalid_input", "Recurrence must be between 0 and 3650 days.", "/recurringDays");
    }

    const allBuckets = await loadBuckets();
    const statusBucket = findBucketBySlug(allBuckets, statusSlug) ?? findBucketBySlug(allBuckets, "inbox");
    let bucketIds: number[] = statusBucket ? [statusBucket.id] : [];
    const paraId = parseOptionalInt(input.paraBucketId);
    if (paraId !== null) {
      bucketIds = appendBucketUnique(bucketIds, paraId);
    }

    const created = await tasks.create({
      title,
      notes: normalizeOptionalText(input.notes),
      url: cleanUrl,
      priority,
      bucketIds,
      scheduledAt,
      pendingBucket: scheduledAt !== null || recurring > 0 ? "now" : null,
      recurringDays: recurring,
      status: "published",
    });

    await enqueueScheduleIfNeeded(created.id, scheduledAt);
    return { id: created.id, slug: created.slug, title: created.title };
  },
);

export const toggleTask = mutation(
  { access: "authenticated" },
  async ({ id }: { id: number | string }) => {
    const taskId = parseOptionalInt(id);
    if (taskId === null) throw new HttpError(422, "invalid_input", "Valid task id required.", "/id");
    const task = await tasks.get(taskId);
    if (!task) throw new HttpError(404, "not_found", "Task not found.");

    if (task.completedAt === null) {
      const effects = await runCompletionSideEffects(task.id, true);
      return {
        id: task.id,
        completed: true,
        nextTaskId: effects.nextTaskId,
        unblockedCount: effects.unblockedIds.length,
      };
    }

    await tasks.update(task.id, { completedAt: null });
    return { id: task.id, completed: false, nextTaskId: null, unblockedCount: 0 };
  },
);

export const completeAndStopRecurring = mutation(
  { access: "authenticated" },
  async ({ id }: { id: number | string }) => {
    const taskId = parseOptionalInt(id);
    if (taskId === null) throw new HttpError(422, "invalid_input", "Valid task id required.", "/id");
    const effects = await runCompletionSideEffects(taskId, false);
    return { id: taskId, completed: true, unblockedCount: effects.unblockedIds.length };
  },
);

export const moveTaskBucket = mutation(
  { access: "authenticated" },
  async ({ id, statusBucket }: { id: number | string; statusBucket: string }) => {
    const taskId = parseOptionalInt(id);
    if (taskId === null) throw new HttpError(422, "invalid_input", "Valid task id required.", "/id");
    const validStatus = asOptionalStatusSlug(statusBucket);
    if (validStatus === null) {
      throw new HttpError(422, "invalid_input", "Unknown status bucket.", "/statusBucket");
    }
    const task = await tasks.get(taskId);
    if (!task) throw new HttpError(404, "not_found", "Task not found.");

    const allBuckets = await loadBuckets();
    const target = findBucketBySlug(allBuckets, validStatus);
    if (!target) throw new HttpError(404, "not_found", "Status bucket is missing.");

    const nextBucketIds = replaceStatusBucket(task.bucketIds, statusBucketIds(allBuckets), target.id);
    await tasks.update(task.id, { bucketIds: nextBucketIds, completedAt: null });
    return { id: task.id, statusBucket: validStatus };
  },
);

export const snoozeTask = mutation(
  { access: "authenticated" },
  async ({ id, days }: { id: number | string; days: number | string }) => {
    const taskId = parseOptionalInt(id);
    const delta = parseOptionalInt(days) ?? 1;
    if (taskId === null) throw new HttpError(422, "invalid_input", "Valid task id required.", "/id");
    const task = await tasks.get(taskId);
    if (!task) throw new HttpError(404, "not_found", "Task not found.");

    const allBuckets = await loadBuckets();
    const laterBucket = findBucketBySlug(allBuckets, "later");
    const nextBucketIds = laterBucket
      ? replaceStatusBucket(task.bucketIds, statusBucketIds(allBuckets), laterBucket.id)
      : task.bucketIds;
    const scheduledAt = computeSnoozeIso(delta, Date.now());

    await tasks.update(task.id, {
      bucketIds: nextBucketIds,
      scheduledAt,
      pendingBucket: "now",
    });
    await enqueueScheduleIfNeeded(task.id, scheduledAt);
    return { id: task.id, scheduledAt };
  },
);

export const updateTask = mutation(
  { access: "authenticated" },
  async (input: {
    id: number | string;
    title: string;
    notes?: string;
    details?: string;
    url?: string;
    priority?: string;
    statusBucket?: string;
    paraBucketIds?: string;
    scheduledDate?: string;
    pendingBucket?: string;
    recurringDays?: string | number;
    blockedBy?: string | number;
  }) => {
    const taskId = parseOptionalInt(input.id);
    if (taskId === null) throw new HttpError(422, "invalid_input", "Valid task id required.", "/id");
    const existing = await tasks.get(taskId);
    if (!existing) throw new HttpError(404, "not_found", "Task not found.");

    const title = normalizeTaskTitle(input.title ?? "");
    if (title === "") {
      throw new HttpError(422, "invalid_input", "Task title cannot be empty.", "/title");
    }

    const rawUrl = normalizeOptionalText(input.url);
    const cleanUrl = normalizeOptionalUrl(rawUrl);
    if (rawUrl !== null && cleanUrl === null) {
      throw new HttpError(422, "invalid_input", "Action URL must start with http:// or https://.", "/url");
    }

    const priority = asPriority(input.priority, existing.priority);
    const statusSlug = asStatusSlug(input.statusBucket, "inbox");
    const allBuckets = await loadBuckets();
    const statusBucket = findBucketBySlug(allBuckets, statusSlug);
    const statusIds = statusBucketIds(allBuckets);

    let nextBucketIds: number[] = [];
    if (input.paraBucketIds !== undefined) {
      const chosenPara = parseBucketCsv(input.paraBucketIds);
      for (const id of chosenPara) {
        if (!statusIds.includes(id)) nextBucketIds.push(id);
      }
      if (statusBucket) nextBucketIds = [statusBucket.id, ...nextBucketIds];
    } else {
      nextBucketIds = replaceStatusBucket(
        existing.bucketIds,
        statusIds,
        statusBucket ? statusBucket.id : null,
      );
    }

    const scheduledAt = parseDateInputToIso(input.scheduledDate);
    const pendingBucket = asOptionalStatusSlug(input.pendingBucket);
    const recurringDays = parseOptionalInt(input.recurringDays) ?? 0;
    const blockedBy = parseOptionalInt(input.blockedBy);
    if (blockedBy === existing.id) {
      throw new HttpError(422, "invalid_input", "A task cannot block itself.", "/blockedBy");
    }

    await tasks.update(existing.id, {
      title,
      notes: normalizeOptionalText(input.notes),
      details: normalizeOptionalText(input.details),
      url: cleanUrl,
      priority,
      bucketIds: nextBucketIds,
      scheduledAt,
      pendingBucket: pendingBucket ?? (scheduledAt !== null || recurringDays > 0 || blockedBy !== null ? "now" : null),
      recurringDays,
      blockedBy,
    });

    await enqueueScheduleIfNeeded(existing.id, scheduledAt);
    return { id: existing.id, title };
  },
);

export const deleteTask = mutation(
  { access: "authenticated", destructive: true },
  async ({ id }: { id: number | string }) => {
    const taskId = parseOptionalInt(id);
    if (taskId === null) throw new HttpError(422, "invalid_input", "Valid task id required.", "/id");
    const gone = await tasks.delete(taskId);
    return { id: gone.id };
  },
);

export const createBucket = mutation(
  { access: "authenticated" },
  async ({ name, kind, color }: { name: string; kind: string; color?: string }) => {
    const cleanName = normalizeTaskTitle(name ?? "");
    if (cleanName === "") {
      throw new HttpError(422, "invalid_input", "Enter a bucket name.", "/name");
    }
    const validKind = asBucketKind(kind);
    if (validKind === null || validKind === "status") {
      throw new HttpError(422, "invalid_input", "Choose project, area, or resource.", "/kind");
    }
    const allBuckets = await loadBuckets();
    const parent = findBucketBySlug(allBuckets, validKind);
    const cleanColor =
      color && /^#[0-9a-fA-F]{6}$/.test(color.trim())
        ? color.trim()
        : validKind === "project"
          ? "#3b82f6"
          : validKind === "area"
            ? "#10b981"
            : "#8b5cf6";

    const created = await buckets.create({
      name: cleanName,
      kind: validKind,
      color: cleanColor,
      parent: parent ? parent.id : 0,
      sortOrder: 50,
    });
    return { id: created.id, slug: created.slug, name: created.name };
  },
);

// Admin queries, DataViews screen, metrics widget, and custom overview dashboard (/wp-admin/new/).
export const openTasksForAdmin = query({ access: "authenticated" }, async () => {
  const rows = await tasks.list({
    where: { completedAt: { isNull: true } },
    orderBy: { updatedAt: "desc" },
    limit: 100,
  });
  return { rows };
});

export const todoMetrics = query({ access: "authenticated" }, async () => {
  const rows = await tasks.list({ limit: 250 });
  const allTasks: TodoTask[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug ?? "",
    notes: row.notes ?? null,
    details: row.details ?? null,
    url: row.url ?? null,
    priority: row.priority,
    bucketIds: row.bucketIds,
    ownerId: row.ownerId,
    completedAt: row.completedAt ?? null,
    scheduledAt: row.scheduledAt ?? null,
    pendingBucket: asOptionalStatusSlug(row.pendingBucket),
    blockedBy: row.blockedBy ?? null,
    recurringDays: row.recurringDays,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
  const allBuckets = await loadBuckets();
  return computeTodoViewCounts(allTasks, allBuckets);
});

export const todoAdminScreen = adminScreen({
  title: "Task inbox",
  access: "authenticated",
  view: {
    action: openTasksForAdmin,
    items: "rows",
    id: "id",
    fields: {
      title: { label: "Task" },
      priority: { label: "Priority" },
      scheduledAt: { label: "Scheduled" },
      recurringDays: { label: "Repeat (days)" },
    },
    layout: {
      type: "table",
      titleField: "title",
      fields: ["priority", "scheduledAt", "recurringDays"],
    },
  },
  actions: [
    { id: "toggle", label: "Complete task", action: toggleTask, input: { id: item("id") } },
    { id: "snooze", label: "Snooze 1 day", action: snoozeTask, input: { id: item("id"), days: 1 } },
    {
      id: "delete",
      label: "Move to trash",
      action: deleteTask,
      input: { id: item("id") },
      confirm: "Move this task to trash? It can still be restored later.",
    },
  ],
});

export const todoSummaryWidget = adminWidget({
  title: "Personal TODO",
  description: "Live GTD counts across your workspace.",
  access: "authenticated",
  action: todoMetrics,
  display: "metrics",
  metrics: [
    { id: "now", label: "Now", path: "now" },
    { id: "inbox", label: "Inbox", path: "inbox" },
    { id: "followUp", label: "Follow-up", path: "followUp" },
    { id: "blocked", label: "Blocked", path: "blocked" },
  ],
  width: 2,
  height: 1,
  link: { label: "Manage tasks", to: "/screens/todoAdminScreen" },
});

export const todoDashboard = adminDashboard({
  title: "TODO Overview",
  description: "Active focus, inbox triage, and recent activity.",
  access: "authenticated",
  menu: { icon: "check" },
  widgets: [
    { widget: todoSummaryWidget, width: 2, height: 1 },
    { widget: "sp/content-overview", width: 2, height: 2 },
    { widget: "sp/recent-activity", width: 2, height: 2 },
  ],
});
