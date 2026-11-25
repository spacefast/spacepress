// Local typed adapter over @spacepress/todo.
import {
  appendBucketUnique as rawAppendBucketUnique,
  computeNextOccurrenceIso as rawComputeNextOccurrenceIso,
  computeScheduleDelaySeconds as rawComputeScheduleDelaySeconds,
  computeSnoozeIso as rawComputeSnoozeIso,
  formatScheduleLabel as rawFormatScheduleLabel,
  isScheduleOverdue as rawIsScheduleOverdue,
  normalizeOptionalText as rawNormalizeOptionalText,
  normalizeOptionalUrl as rawNormalizeOptionalUrl,
  normalizeTaskTitle as rawNormalizeTaskTitle,
  parseDateInputToIso as rawParseDateInputToIso,
  removeBucketId as rawRemoveBucketId,
  replaceKindBucket as rawReplaceKindBucket,
  userInitials as rawUserInitials,
} from "@spacepress/todo";

export type TodoStatusSlug = "inbox" | "now" | "later" | "follow-up";
export type TodoBucketKind = "status" | "project" | "area" | "resource";
export type TodoPriority = "none" | "low" | "medium" | "high";
export type TodoVisibility = "private" | "team";
export type TodoLayout = "list" | "board";
export type TodoBoardGroup = "status" | "project" | "area" | "resource" | "priority";
export type TodoFlagFilter = "blocked" | "recurring" | "team" | "scheduled";
export type TodoView =
  | "now"
  | "inbox"
  | "follow-up"
  | "later"
  | "scheduled"
  | "blocked"
  | "team"
  | "all"
  | "done";

export interface TodoChecklistItem {
  label: string;
  done: boolean;
}

export interface TodoBucket {
  id: number;
  name: string;
  slug: string;
  parent: number;
  kind: TodoBucketKind;
  color: string | null;
  sortOrder: number;
}

export interface TodoTask {
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
  tasks: TodoTask[];
}

function asNumberArray(raw: unknown): number[] {
  const text = String(raw ?? "");
  if (text === "") return [];
  const out: number[] = [];
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const id = Number.parseInt(trimmed, 10);
    if (Number.isInteger(id) && id > 0 && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

export function decodeWpText(raw: string): string {
  return raw
    .replaceAll("&amp;", "&")
    .replaceAll("&#038;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#039;", "'");
}

export function asStatusSlug(raw: string | null | undefined, fallback: TodoStatusSlug): TodoStatusSlug {
  if (raw === "inbox") return "inbox";
  if (raw === "now") return "now";
  if (raw === "later") return "later";
  if (raw === "follow-up") return "follow-up";
  return fallback;
}

export function asOptionalStatusSlug(raw: string | null | undefined): TodoStatusSlug | null {
  if (raw === "inbox") return "inbox";
  if (raw === "now") return "now";
  if (raw === "later") return "later";
  if (raw === "follow-up") return "follow-up";
  return null;
}

export function asPriority(raw: string | null | undefined, fallback: TodoPriority): TodoPriority {
  if (raw === "none") return "none";
  if (raw === "low") return "low";
  if (raw === "medium") return "medium";
  if (raw === "high") return "high";
  return fallback;
}

export function asOptionalPriority(raw: string | null | undefined): TodoPriority | null {
  if (raw === "none") return "none";
  if (raw === "low") return "low";
  if (raw === "medium") return "medium";
  if (raw === "high") return "high";
  return null;
}

export function asVisibility(raw: string | null | undefined, fallback: TodoVisibility): TodoVisibility {
  if (raw === "team") return "team";
  if (raw === "private") return "private";
  return fallback;
}

export function asLayout(raw: string | null | undefined, fallback: TodoLayout): TodoLayout {
  if (raw === "board") return "board";
  if (raw === "list") return "list";
  return fallback;
}

export function asBoardGroup(raw: string | null | undefined, fallback: TodoBoardGroup): TodoBoardGroup {
  if (raw === "status") return "status";
  if (raw === "project") return "project";
  if (raw === "area") return "area";
  if (raw === "resource") return "resource";
  if (raw === "priority") return "priority";
  return fallback;
}

export function asOptionalFlagFilter(raw: string | null | undefined): TodoFlagFilter | null {
  if (raw === "blocked") return "blocked";
  if (raw === "recurring") return "recurring";
  if (raw === "team") return "team";
  if (raw === "scheduled") return "scheduled";
  return null;
}

export function asBucketKind(raw: string | null | undefined): TodoBucketKind | null {
  if (raw === "status") return "status";
  if (raw === "project") return "project";
  if (raw === "area") return "area";
  if (raw === "resource") return "resource";
  return null;
}

export function asTodoView(raw: string | null | undefined): TodoView {
  if (raw === "now") return "now";
  if (raw === "inbox") return "inbox";
  if (raw === "follow-up") return "follow-up";
  if (raw === "later") return "later";
  if (raw === "scheduled") return "scheduled";
  if (raw === "blocked") return "blocked";
  if (raw === "team") return "team";
  if (raw === "all") return "all";
  if (raw === "done") return "done";
  return "now";
}

export function normalizeTaskTitle(raw: string): string {
  const out = rawNormalizeTaskTitle(raw);
  return typeof out === "string" ? out : raw.trim();
}

export function normalizeOptionalText(raw: string | null | undefined): string | null {
  const out = rawNormalizeOptionalText(raw);
  return typeof out === "string" ? out : null;
}

export function normalizeOptionalUrl(raw: string | null | undefined): string | null {
  const out = rawNormalizeOptionalUrl(raw);
  return typeof out === "string" ? out : null;
}

export function parseDateInputToIso(raw: string | null | undefined): string | null {
  const out = rawParseDateInputToIso(raw);
  return typeof out === "string" ? out : null;
}

export function computeNextOccurrenceIso(fromIso: string, recurringDays: number): string {
  const out = rawComputeNextOccurrenceIso(fromIso, recurringDays);
  return typeof out === "string" ? out : fromIso;
}

export function computeSnoozeIso(daysFromNow: number, nowMs: number): string {
  const out = rawComputeSnoozeIso(daysFromNow, nowMs);
  return typeof out === "string" ? out : new Date(nowMs + daysFromNow * 86_400_000).toISOString();
}

export function computeScheduleDelaySeconds(scheduledAtIso: string, nowMs: number): number {
  const out = rawComputeScheduleDelaySeconds(scheduledAtIso, nowMs);
  return typeof out === "number" ? out : 0;
}

export function replaceKindBucket(
  currentIds: number[],
  kindBucketIds: number[],
  nextBucketId: number | null,
): number[] {
  return asNumberArray(rawReplaceKindBucket(currentIds, kindBucketIds, nextBucketId));
}

export function replaceStatusBucket(
  currentIds: number[],
  allStatusIds: number[],
  nextStatusId: number | null,
): number[] {
  return replaceKindBucket(currentIds, allStatusIds, nextStatusId);
}

export function appendBucketUnique(currentIds: number[], bucketId: number): number[] {
  return asNumberArray(rawAppendBucketUnique(currentIds, bucketId));
}

export function removeBucketId(currentIds: number[], bucketId: number): number[] {
  return asNumberArray(rawRemoveBucketId(currentIds, bucketId));
}

export function formatScheduleLabel(scheduledAt: string | null, todayYmd: string): string {
  const out = rawFormatScheduleLabel(scheduledAt, todayYmd);
  return typeof out === "string" ? out : "";
}

export function isScheduleOverdue(scheduledAt: string | null, todayYmd: string): boolean {
  const out = rawIsScheduleOverdue(scheduledAt, todayYmd);
  return typeof out === "boolean" ? out : false;
}

export function userInitials(displayName: string): string {
  const out = rawUserInitials(displayName);
  return typeof out === "string" ? out : "?";
}

export function findBucketBySlug(buckets: TodoBucket[], slug: string): TodoBucket | null {
  for (const bucket of buckets) {
    if (bucket.slug === slug) return bucket;
  }
  return null;
}

export function bucketIdsForKind(buckets: TodoBucket[], kind: TodoBucketKind): number[] {
  const ids: number[] = [];
  for (const bucket of buckets) {
    if (bucket.kind === kind && bucket.parent > 0) ids.push(bucket.id);
  }
  return ids;
}

export function statusBucketIds(buckets: TodoBucket[]): number[] {
  return bucketIdsForKind(buckets, "status");
}

export function taskStatusSlug(task: TodoTask, buckets: TodoBucket[]): TodoStatusSlug | null {
  for (const bucketId of task.bucketIds) {
    for (const bucket of buckets) {
      if (bucket.id === bucketId && bucket.kind === "status") {
        const slug = asOptionalStatusSlug(bucket.slug);
        if (slug !== null) return slug;
      }
    }
  }
  return null;
}

export function taskHasBucketSlug(task: TodoTask, buckets: TodoBucket[], slug: string): boolean {
  for (const bucketId of task.bucketIds) {
    for (const bucket of buckets) {
      if (bucket.id === bucketId && bucket.slug === slug) return true;
    }
  }
  return false;
}

export function taskParaBuckets(task: TodoTask, buckets: TodoBucket[]): TodoBucket[] {
  const out: TodoBucket[] = [];
  for (const bucketId of task.bucketIds) {
    for (const bucket of buckets) {
      if (bucket.id === bucketId && bucket.kind !== "status" && bucket.parent > 0) {
        out.push(bucket);
      }
    }
  }
  return out;
}

export function isTaskBlocked(task: TodoTask, openTaskIds: number[]): boolean {
  if (task.completedAt !== null) return false;
  if (task.blockedBy === null) return false;
  return openTaskIds.includes(task.blockedBy);
}

export function checklistProgress(checklist: TodoChecklistItem[]): { done: number; total: number } {
  let done = 0;
  for (const entry of checklist) {
    if (entry.done) done += 1;
  }
  return { done, total: checklist.length };
}

export function priorityRank(priority: TodoPriority): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  if (priority === "low") return 1;
  return 0;
}

export function computeTodoViewCounts(tasks: TodoTask[], buckets: TodoBucket[]): TodoViewCounts {
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
  tasks: TodoTask[],
  buckets: TodoBucket[],
  view: TodoView,
  bucketSlug: string | null,
  query: string | null,
  priorityFilter: TodoPriority | null,
  flagFilter: TodoFlagFilter | null,
): TodoTask[] {
  const openIds: number[] = [];
  for (const task of tasks) {
    if (task.completedAt === null) openIds.push(task.id);
  }
  const needle = query ? query.trim().toLowerCase() : "";
  const out: TodoTask[] = [];

  for (const task of tasks) {
    const isDone = task.completedAt !== null;
    if (bucketSlug && bucketSlug !== "") {
      if (isDone) continue;
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
  tasks: TodoTask[],
  buckets: TodoBucket[],
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
        key: "bucket:none",
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
      subtitle: "Collaborative tasks visible to signed-in teammates on this WordPress site.",
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
