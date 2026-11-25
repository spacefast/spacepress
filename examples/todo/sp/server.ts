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
  asBoardGroup,
  asBucketKind,
  asOptionalPriority,
  asOptionalStatusSlug,
  asPriority,
  asStatusSlug,
  asVisibility,
  bucketIdsForKind,
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
  replaceKindBucket,
  replaceStatusBucket,
  statusBucketIds,
  type TodoBucket,
  type TodoChecklistItem,
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

  // 1. Spawn the next recurring occurrence when configured (kept out of active target status until due).
  let nextTaskId: number | null = null;
  if (allowRecurrence && task.recurringDays > 0) {
    const destSlug = asStatusSlug(task.pendingBucket, "now");
    const destBucket = findBucketBySlug(allBuckets, destSlug);
    const laterBucket = findBucketBySlug(allBuckets, "later");
    let nextBuckets = destBucket ? removeBucketId(task.bucketIds, destBucket.id) : [...task.bucketIds];
    if (laterBucket) {
      nextBuckets = replaceStatusBucket(nextBuckets, statusIds, laterBucket.id);
    }
    const resetChecklist: TodoChecklistItem[] = (task.checklist ?? []).map((entry) => ({
      label: entry.label,
      done: false,
    }));
    const nextScheduledAt = computeNextOccurrenceIso(nowIso, task.recurringDays);
    const created = await tasks.create({
      title: task.title,
      notes: task.notes,
      details: task.details,
      url: task.url,
      priority: task.priority,
      visibility: task.visibility,
      assigneeId: task.assigneeId,
      checklist: resetChecklist,
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
  async (
    input: {
      title: string;
      notes?: string;
      url?: string;
      priority?: string;
      visibility?: string;
      assigneeId?: string | number;
      statusBucket?: string;
      paraBucketId?: string | number;
      scheduledDate?: string;
      recurringDays?: string | number;
    },
    ctx,
  ) => {
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
    const visibility = asVisibility(input.visibility, "private");
    const assigneeId = parseOptionalInt(input.assigneeId) ?? (visibility === "team" && ctx.user ? ctx.user.id : null);
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
      visibility,
      assigneeId,
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

// Generic Kanban column transition — works for any taxonomy kind (status, project, area, resource),
// priority, or the optional Completed column.
export const moveTaskColumn = mutation(
  { access: "authenticated" },
  async (input: {
    id: number | string;
    groupBy: string;
    targetBucketId?: number | string | null;
    targetPriority?: string | null;
    complete?: boolean;
  }) => {
    const taskId = parseOptionalInt(input.id);
    if (taskId === null) throw new HttpError(422, "invalid_input", "Valid task id required.", "/id");
    const task = await tasks.get(taskId);
    if (!task) throw new HttpError(404, "not_found", "Task not found.");

    if (input.complete === true) {
      if (task.completedAt === null) {
        await runCompletionSideEffects(task.id, true);
      }
      return { id: task.id, completed: true };
    }

    const group = asBoardGroup(input.groupBy, "status");
    if (group === "priority") {
      const nextPriority = asOptionalPriority(input.targetPriority);
      if (nextPriority === null) {
        throw new HttpError(422, "invalid_input", "Invalid target priority.", "/targetPriority");
      }
      await tasks.update(task.id, { priority: nextPriority, completedAt: null });
      return { id: task.id, completed: false };
    }

    const bucketKind = asBucketKind(group);
    if (bucketKind === null) {
      throw new HttpError(422, "invalid_input", "Unsupported board group.", "/groupBy");
    }
    const allBuckets = await loadBuckets();
    const kindIds = bucketIdsForKind(allBuckets, bucketKind);
    const nextBucketId = parseOptionalInt(input.targetBucketId);
    if (nextBucketId !== null && !kindIds.includes(nextBucketId)) {
      throw new HttpError(422, "invalid_input", "Target bucket does not match this board group.", "/targetBucketId");
    }
    const nextBucketIds = replaceKindBucket(task.bucketIds, kindIds, nextBucketId);
    await tasks.update(task.id, { bucketIds: nextBucketIds, completedAt: null });
    return { id: task.id, completed: false };
  },
);

export const toggleChecklistItem = mutation(
  { access: "authenticated" },
  async ({ id, index }: { id: number | string; index: number | string }) => {
    const taskId = parseOptionalInt(id);
    const itemIndex = typeof index === "number" ? index : Number.parseInt(index, 10);
    if (taskId === null) throw new HttpError(422, "invalid_input", "Valid task id required.", "/id");
    const task = await tasks.get(taskId);
    if (!task) throw new HttpError(404, "not_found", "Task not found.");
    const list = task.checklist ?? [];
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= list.length) {
      throw new HttpError(422, "invalid_input", "Checklist item not found.", "/index");
    }
    const next: TodoChecklistItem[] = list.map((entry, idx) =>
      idx === itemIndex ? { label: entry.label, done: !entry.done } : { label: entry.label, done: entry.done },
    );
    await tasks.update(task.id, { checklist: next });
    return { id: task.id, checklist: next };
  },
);

export const addChecklistItem = mutation(
  { access: "authenticated" },
  async ({ id, label }: { id: number | string; label: string }) => {
    const taskId = parseOptionalInt(id);
    if (taskId === null) throw new HttpError(422, "invalid_input", "Valid task id required.", "/id");
    const clean = normalizeTaskTitle(label ?? "");
    if (clean === "") throw new HttpError(422, "invalid_input", "Enter a subtask label.", "/label");
    if (clean.length > 200) throw new HttpError(422, "invalid_input", "Subtask is too long.", "/label");
    const task = await tasks.get(taskId);
    if (!task) throw new HttpError(404, "not_found", "Task not found.");
    const list = task.checklist ?? [];
    const next: TodoChecklistItem[] = [
      ...list.map((entry) => ({ label: entry.label, done: entry.done })),
      { label: clean, done: false },
    ];
    await tasks.update(task.id, { checklist: next });
    return { id: task.id, checklist: next };
  },
);

export const removeChecklistItem = mutation(
  { access: "authenticated" },
  async ({ id, index }: { id: number | string; index: number | string }) => {
    const taskId = parseOptionalInt(id);
    const itemIndex = typeof index === "number" ? index : Number.parseInt(index, 10);
    if (taskId === null) throw new HttpError(422, "invalid_input", "Valid task id required.", "/id");
    const task = await tasks.get(taskId);
    if (!task) throw new HttpError(404, "not_found", "Task not found.");
    const list = task.checklist ?? [];
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= list.length) {
      throw new HttpError(422, "invalid_input", "Checklist item not found.", "/index");
    }
    const next: TodoChecklistItem[] = [];
    for (let i = 0; i < list.length; i += 1) {
      if (i !== itemIndex) {
        const entry = list[i]!;
        next.push({ label: entry.label, done: entry.done });
      }
    }
    await tasks.update(task.id, { checklist: next });
    return { id: task.id, checklist: next };
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
    visibility?: string;
    assigneeId?: string | number;
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
    const visibility = asVisibility(input.visibility, existing.visibility);
    const assigneeId =
      input.assigneeId !== undefined ? parseOptionalInt(input.assigneeId) : existing.assigneeId;
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
      visibility,
      assigneeId,
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
    if (validKind === null) {
      throw new HttpError(422, "invalid_input", "Choose status, project, area, or resource.", "/kind");
    }
    const allBuckets = await loadBuckets();
    const parent = findBucketBySlug(allBuckets, validKind);
    const cleanColor =
      color && /^#[0-9a-fA-F]{6}$/.test(color.trim())
        ? color.trim()
        : validKind === "status"
          ? "#f59e0b"
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
    visibility: row.visibility,
    assigneeId: row.assigneeId ?? null,
    checklist: row.checklist ?? [],
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
      visibility: { label: "Visibility" },
      scheduledAt: { label: "Scheduled" },
      recurringDays: { label: "Repeat (days)" },
    },
    layout: {
      type: "table",
      titleField: "title",
      fields: ["priority", "visibility", "scheduledAt", "recurringDays"],
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
  title: "Todo Summary",
  description: "Live counts across your workspace.",
  access: "authenticated",
  action: todoMetrics,
  display: "metrics",
  metrics: [
    { id: "now", label: "Now", path: "now" },
    { id: "inbox", label: "Inbox", path: "inbox" },
    { id: "team", label: "Team", path: "team" },
    { id: "blocked", label: "Blocked", path: "blocked" },
  ],
  width: 2,
  height: 1,
  link: { label: "Manage tasks", to: "/screens/todo-admin-screen" },
});

export const todoDashboard = adminDashboard({
  title: "Todo Overview",
  description: "Active focus, inbox triage, team tasks, and recent activity.",
  access: "authenticated",
  menu: { icon: "check" },
  widgets: [
    { widget: todoSummaryWidget, width: 2, height: 1 },
    { widget: "sp/content-overview", width: 2, height: 2 },
    { widget: "sp/recent-activity", width: 2, height: 2 },
  ],
});
