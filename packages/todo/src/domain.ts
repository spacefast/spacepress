// Pure domain model and helpers for @spacepress/todo.
// Written in the SpacePress TypeScript subset so both PHP server handlers/pages
// and Node tests execute the exact same rules.

export const TODO_STATUS_SLUGS = ["inbox", "now", "later", "follow-up"] as const;
export type TodoStatusSlug = (typeof TODO_STATUS_SLUGS)[number];

export const TODO_BUCKET_KINDS = ["status", "project", "area", "resource"] as const;
export type TodoBucketKind = (typeof TODO_BUCKET_KINDS)[number];

export const TODO_PRIORITIES = ["none", "low", "medium", "high"] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

export const TODO_VISIBILITIES = ["private", "team"] as const;
export type TodoVisibility = (typeof TODO_VISIBILITIES)[number];

export const TODO_LAYOUTS = ["list", "board"] as const;
export type TodoLayout = (typeof TODO_LAYOUTS)[number];

export const TODO_BOARD_GROUPS = ["status", "project", "area", "resource", "priority"] as const;
export type TodoBoardGroup = (typeof TODO_BOARD_GROUPS)[number];

export const TODO_FLAG_FILTERS = ["blocked", "recurring", "team", "scheduled"] as const;
export type TodoFlagFilter = (typeof TODO_FLAG_FILTERS)[number];

export const TODO_VIEWS = [
  "now",
  "inbox",
  "follow-up",
  "later",
  "scheduled",
  "blocked",
  "team",
  "all",
  "done",
] as const;
export type TodoView = (typeof TODO_VIEWS)[number];

export interface TodoChecklistItem {
  label: string;
  done: boolean;
}

export interface TodoBucketItem {
  id: number;
  name: string;
  slug: string;
  parent: number;
  kind: TodoBucketKind;
  color: string | null;
  sortOrder: number;
}

export interface TodoTaskItem {
  id: number;
  title: string;
  slug: string;
  notes: string | null;
  details: string | null;
  url: string | null;
  priority: TodoPriority;
  visibility: TodoVisibility;
  assigneeId: number | null;
  checklist: TodoChecklistItem[];
  bucketIds: number[];
  ownerId: number;
  completedAt: string | null;
  scheduledAt: string | null;
  pendingBucket: TodoStatusSlug | null;
  blockedBy: number | null;
  recurringDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface TodoViewCounts {
  now: number;
  inbox: number;
  followUp: number;
  later: number;
  scheduled: number;
  blocked: number;
  team: number;
  all: number;
  done: number;
}

export interface TodoKanbanColumn {
  key: string;
  label: string;
  color: string;
  bucketId: number | null;
  priority: TodoPriority | null;
  isCompleted: boolean;
  tasks: TodoTaskItem[];
}

export function isTodoStatusSlug(value: string): value is TodoStatusSlug {
  return value === "inbox" || value === "now" || value === "later" || value === "follow-up";
}

export function isTodoPriority(value: string): value is TodoPriority {
  return value === "none" || value === "low" || value === "medium" || value === "high";
}

export function isTodoBucketKind(value: string): value is TodoBucketKind {
  return value === "status" || value === "project" || value === "area" || value === "resource";
}

export function isTodoVisibility(value: string): value is TodoVisibility {
  return value === "private" || value === "team";
}

export function normalizeTodoView(raw: string | null | undefined): TodoView {
  if (
    raw === "now" ||
    raw === "inbox" ||
    raw === "follow-up" ||
    raw === "later" ||
    raw === "scheduled" ||
    raw === "blocked" ||
    raw === "team" ||
    raw === "all" ||
    raw === "done"
  ) {
    return raw;
  }
  return "now";
}

export function normalizeTaskTitle(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function normalizeOptionalText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeOptionalUrl(raw: string | null | undefined): string | null {
  const trimmed = normalizeOptionalText(raw);
  if (trimmed === null) return null;
  if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) {
    return null;
  }
  return trimmed;
}

export function parseDateInputToIso(raw: string | null | undefined): string | null {
  const trimmed = normalizeOptionalText(raw);
  if (trimmed === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T09:00:00.000Z`;
  }
  const parsed = new Date(trimmed).getTime();
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function computeNextOccurrenceIso(fromIso: string, recurringDays: number): string {
  const baseMs = new Date(fromIso).getTime();
  const safeBase = Number.isNaN(baseMs) ? Date.now() : baseMs;
  const nextMs = safeBase + recurringDays * 86_400_000;
  return new Date(nextMs).toISOString();
}

export function computeSnoozeIso(daysFromNow: number, nowMs: number): string {
  const target = new Date(nowMs + daysFromNow * 86_400_000);
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(target.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T09:00:00.000Z`;
}

export function computeScheduleDelaySeconds(scheduledAtIso: string, nowMs: number): number {
  const targetMs = new Date(scheduledAtIso).getTime();
  if (Number.isNaN(targetMs)) return 0;
  const diff = Math.floor((targetMs - nowMs) / 1000);
  return diff > 0 ? diff : 0;
}

export function replaceKindBucket(
  currentIds: readonly number[],
  kindBucketIds: readonly number[],
  nextBucketId: number | null,
): number[] {
  const kept: number[] = [];
  for (const id of currentIds) {
    if (!kindBucketIds.includes(id) && !kept.includes(id)) {
      kept.push(id);
    }
  }
  if (nextBucketId !== null && !kept.includes(nextBucketId)) {
    return [nextBucketId, ...kept];
  }
  return kept;
}

export function replaceStatusBucket(
  currentIds: readonly number[],
  allStatusIds: readonly number[],
  nextStatusId: number | null,
): number[] {
  return replaceKindBucket(currentIds, allStatusIds, nextStatusId);
}

export function appendBucketUnique(currentIds: readonly number[], bucketId: number): number[] {
  const next: number[] = [];
  for (const id of currentIds) {
    if (!next.includes(id)) next.push(id);
  }
  if (!next.includes(bucketId)) {
    next.push(bucketId);
  }
  return next;
}

export function removeBucketId(currentIds: readonly number[], bucketId: number): number[] {
  const next: number[] = [];
  for (const id of currentIds) {
    if (id !== bucketId && !next.includes(id)) {
      next.push(id);
    }
  }
  return next;
}

export function isAssignableBucket(bucket: TodoBucketItem): boolean {
  return bucket.parent > 0;
}

export function findBucketBySlug(buckets: readonly TodoBucketItem[], slug: string): TodoBucketItem | null {
  for (const bucket of buckets) {
    if (bucket.slug === slug) return bucket;
  }
  return null;
}

export function bucketIdsForKind(buckets: readonly TodoBucketItem[], kind: TodoBucketKind): number[] {
  const ids: number[] = [];
  for (const bucket of buckets) {
    if (bucket.kind === kind && bucket.parent > 0) {
      ids.push(bucket.id);
    }
  }
  return ids;
}

export function statusBucketIds(buckets: readonly TodoBucketItem[]): number[] {
  return bucketIdsForKind(buckets, "status");
}

export function taskStatusSlug(
  task: Pick<TodoTaskItem, "bucketIds">,
  buckets: readonly TodoBucketItem[],
): TodoStatusSlug | null {
  for (const bucketId of task.bucketIds) {
    for (const bucket of buckets) {
      if (bucket.id === bucketId && bucket.kind === "status" && isTodoStatusSlug(bucket.slug)) {
        return bucket.slug;
      }
    }
  }
  return null;
}

export function taskHasBucketSlug(
  task: Pick<TodoTaskItem, "bucketIds">,
  buckets: readonly TodoBucketItem[],
  slug: string,
): boolean {
  for (const bucketId of task.bucketIds) {
    for (const bucket of buckets) {
      if (bucket.id === bucketId && bucket.slug === slug) {
        return true;
      }
    }
  }
  return false;
}

export function taskParaBuckets(
  task: Pick<TodoTaskItem, "bucketIds">,
  buckets: readonly TodoBucketItem[],
): TodoBucketItem[] {
  const out: TodoBucketItem[] = [];
  for (const bucketId of task.bucketIds) {
    for (const bucket of buckets) {
      if (bucket.id === bucketId && bucket.kind !== "status" && bucket.parent > 0) {
        out.push(bucket);
      }
    }
  }
  return out;
}

export function isTaskBlocked(
  task: Pick<TodoTaskItem, "blockedBy" | "completedAt">,
  openTaskIds: readonly number[],
): boolean {
  if (task.completedAt !== null) return false;
  if (task.blockedBy === null) return false;
  return openTaskIds.includes(task.blockedBy);
}

export function checklistProgress(checklist: readonly TodoChecklistItem[] | null | undefined): {
  done: number;
  total: number;
} {
  if (!checklist || checklist.length === 0) return { done: 0, total: 0 };
  let done = 0;
  for (const entry of checklist) {
    if (entry.done) done += 1;
  }
  return { done, total: checklist.length };
}

export function userInitials(displayName: string): string {
  const clean = displayName.trim();
  if (clean === "") return "?";
  const parts = clean.split(/\s+/).filter((p) => p !== "");
  if (parts.length >= 2) {
    return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function priorityRank(priority: TodoPriority): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  if (priority === "low") return 1;
  return 0;
}

export function computeTodoViewCounts(
  tasks: readonly TodoTaskItem[],
  buckets: readonly TodoBucketItem[],
): TodoViewCounts {
  const openIds: number[] = [];
  for (const task of tasks) {
    if (task.completedAt === null) openIds.push(task.id);
  }
  let now = 0;
  let inbox = 0;
  let followUp = 0;
  let later = 0;
  let scheduled = 0;
  let blocked = 0;
  let team = 0;
  let all = 0;
  let done = 0;

  for (const task of tasks) {
    if (task.completedAt !== null) {
      done += 1;
      continue;
    }
    all += 1;
    const status = taskStatusSlug(task, buckets);
    if (status === "now") now += 1;
    if (status === "inbox") inbox += 1;
    if (status === "follow-up") followUp += 1;
    if (status === "later") later += 1;
    if (task.scheduledAt !== null) scheduled += 1;
    if (isTaskBlocked(task, openIds)) blocked += 1;
    if (task.visibility === "team") team += 1;
  }

  return { now, inbox, followUp, later, scheduled, blocked, team, all, done };
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function filterTasksForView(
  tasks: readonly TodoTaskItem[],
  buckets: readonly TodoBucketItem[],
  view: TodoView,
  bucketSlug: string | null,
  query: string | null,
  priorityFilter: TodoPriority | null = null,
  flagFilter: TodoFlagFilter | null = null,
): TodoTaskItem[] {
  const openIds: number[] = [];
  for (const task of tasks) {
    if (task.completedAt === null) openIds.push(task.id);
  }
  const needle = query ? query.trim().toLowerCase() : "";
  const out: TodoTaskItem[] = [];

  for (const task of tasks) {
    const isDone = task.completedAt !== null;
    if (bucketSlug && bucketSlug !== "") {
      if (view === "done" ? !isDone : isDone) continue;
      if (!taskHasBucketSlug(task, buckets, bucketSlug)) continue;
    } else if (view === "done") {
      if (!isDone) continue;
    } else {
      if (isDone) continue;
      if (view === "now" && !taskHasBucketSlug(task, buckets, "now")) continue;
      if (view === "inbox" && !taskHasBucketSlug(task, buckets, "inbox")) continue;
      if (view === "follow-up" && !taskHasBucketSlug(task, buckets, "follow-up")) continue;
      if (view === "later" && !taskHasBucketSlug(task, buckets, "later")) continue;
      if (view === "scheduled" && task.scheduledAt === null) continue;
      if (view === "blocked" && !isTaskBlocked(task, openIds)) continue;
      if (view === "team" && task.visibility !== "team") continue;
    }

    if (priorityFilter !== null && task.priority !== priorityFilter) continue;
    if (flagFilter === "blocked" && !isTaskBlocked(task, openIds)) continue;
    if (flagFilter === "recurring" && task.recurringDays <= 0) continue;
    if (flagFilter === "team" && task.visibility !== "team") continue;
    if (flagFilter === "scheduled" && task.scheduledAt === null) continue;

    if (needle !== "") {
      const hay = `${task.title} ${task.notes ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }

    out.push(task);
  }

  out.sort((a, b) => {
    if (view === "done") {
      return compareStrings(b.completedAt ?? "", a.completedAt ?? "");
    }
    if (view === "scheduled") {
      return compareStrings(a.scheduledAt ?? "9999", b.scheduledAt ?? "9999");
    }
    const pr = priorityRank(b.priority) - priorityRank(a.priority);
    if (pr !== 0) return pr;
    return compareStrings(b.updatedAt, a.updatedAt);
  });

  return out;
}

export function buildKanbanColumns(
  tasks: readonly TodoTaskItem[],
  buckets: readonly TodoBucketItem[],
  groupBy: TodoBoardGroup,
  showDone: boolean,
): TodoKanbanColumn[] {
  const openTasks = tasks.filter((t) => t.completedAt === null);
  const doneTasks = tasks.filter((t) => t.completedAt !== null);
  const columns: TodoKanbanColumn[] = [];

  if (groupBy === "priority") {
    const levels: { key: TodoPriority; label: string; color: string }[] = [
      { key: "high", label: "High priority", color: "#dc2626" },
      { key: "medium", label: "Medium", color: "#d97706" },
      { key: "low", label: "Low", color: "#2563eb" },
      { key: "none", label: "No priority", color: "#64748b" },
    ];
    for (const level of levels) {
      columns.push({
        key: `priority:${level.key}`,
        label: level.label,
        color: level.color,
        bucketId: null,
        priority: level.key,
        isCompleted: false,
        tasks: openTasks.filter((t) => t.priority === level.key),
      });
    }
  } else {
    const groupBuckets = buckets.filter((b) => b.kind === groupBy && b.parent > 0);
    const groupIds = groupBuckets.map((b) => b.id);
    for (const bucket of groupBuckets) {
      columns.push({
        key: `bucket:${bucket.id}`,
        label: bucket.name,
        color: bucket.color ?? "#64748b",
        bucketId: bucket.id,
        priority: null,
        isCompleted: false,
        tasks: openTasks.filter((t) => t.bucketIds.includes(bucket.id)),
      });
    }
    const unassigned = openTasks.filter((t) => !t.bucketIds.some((id) => groupIds.includes(id)));
    if (groupBy !== "status" || unassigned.length > 0) {
      columns.push({
        key: `bucket:none`,
        label: groupBy === "status" ? "Unsorted" : `No ${groupBy}`,
        color: "#94a3b8",
        bucketId: null,
        priority: null,
        isCompleted: false,
        tasks: unassigned,
      });
    }
  }

  if (showDone) {
    columns.push({
      key: "completed",
      label: "Completed",
      color: "#059669",
      bucketId: null,
      priority: null,
      isCompleted: true,
      tasks: doneTasks,
    });
  }

  return columns;
}

export function formatScheduleLabel(scheduledAt: string | null, todayYmd: string): string {
  if (!scheduledAt) return "";
  const ymd = scheduledAt.slice(0, 10);
  if (ymd === todayYmd) return "Today";
  const todayMs = new Date(`${todayYmd}T00:00:00.000Z`).getTime();
  const targetMs = new Date(`${ymd}T00:00:00.000Z`).getTime();
  if (!Number.isNaN(todayMs) && !Number.isNaN(targetMs)) {
    const diffDays = Math.round((targetMs - todayMs) / 86_400_000);
    if (diffDays === 1) return "Tomorrow";
    if (diffDays === -1) return "Yesterday";
    if (diffDays < -1) return `${Math.abs(diffDays)}d overdue`;
    if (diffDays > 1 && diffDays <= 6) return `In ${diffDays}d`;
  }
  return ymd;
}

export function isScheduleOverdue(scheduledAt: string | null, todayYmd: string): boolean {
  if (!scheduledAt) return false;
  return scheduledAt.slice(0, 10) < todayYmd;
}

export function viewMeta(view: TodoView): { title: string; subtitle: string; defaultStatus: TodoStatusSlug } {
  if (view === "inbox") {
    return {
      title: "Inbox",
      subtitle: "Capture quickly, then triage into Now, Follow-up, or Later.",
      defaultStatus: "inbox",
    };
  }
  if (view === "follow-up") {
    return {
      title: "Follow-up",
      subtitle: "Tasks waiting on someone else or an external reply.",
      defaultStatus: "follow-up",
    };
  }
  if (view === "later") {
    return {
      title: "Later",
      subtitle: "Good ideas and next steps parked out of today's focus.",
      defaultStatus: "later",
    };
  }
  if (view === "scheduled") {
    return {
      title: "Scheduled",
      subtitle: "Upcoming and recurring tasks promoted automatically when due.",
      defaultStatus: "later",
    };
  }
  if (view === "blocked") {
    return {
      title: "Blocked",
      subtitle: "Tasks waiting on another task — released automatically when their blocker finishes.",
      defaultStatus: "later",
    };
  }
  if (view === "team") {
    return {
      title: "Shared with Team",
      subtitle: "Collaborative tasks visible to teammates (and read-only in public previews).",
      defaultStatus: "now",
    };
  }
  if (view === "all") {
    return {
      title: "All Open",
      subtitle: "Every active task across your workflow and PARA buckets.",
      defaultStatus: "inbox",
    };
  }
  if (view === "done") {
    return {
      title: "Completed",
      subtitle: "Finished tasks with their original buckets and comment notes intact.",
      defaultStatus: "now",
    };
  }
  return {
    title: "Now",
    subtitle: "Your active focus list for today.",
    defaultStatus: "now",
  };
}
