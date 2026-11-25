import assert from "node:assert/strict";
import test from "node:test";
import {
  appendBucketUnique,
  computeNextOccurrenceIso,
  computeScheduleDelaySeconds,
  computeTodoViewCounts,
  filterTasksForView,
  formatScheduleLabel,
  isScheduleOverdue,
  parseDateInputToIso,
  removeBucketId,
  replaceStatusBucket,
  statusBucketIds,
  taskStatusSlug,
} from "../src/domain.ts";

const buckets = [
  { id: 1, name: "Status", slug: "status", parent: 0, kind: "status", color: null, sortOrder: 0 },
  { id: 2, name: "Inbox", slug: "inbox", parent: 1, kind: "status", color: "#3b82f6", sortOrder: 1 },
  { id: 3, name: "Now", slug: "now", parent: 1, kind: "status", color: "#f59e0b", sortOrder: 2 },
  { id: 4, name: "Follow-up", slug: "follow-up", parent: 1, kind: "status", color: "#8b5cf6", sortOrder: 3 },
  { id: 5, name: "Later", slug: "later", parent: 1, kind: "status", color: "#64748b", sortOrder: 4 },
  { id: 10, name: "Projects", slug: "project", parent: 0, kind: "project", color: null, sortOrder: 10 },
  { id: 11, name: "SpacePress", slug: "spacepress", parent: 10, kind: "project", color: "#10b981", sortOrder: 11 },
];

const tasks = [
  {
    id: 101,
    title: "Ship todo package",
    slug: "ship-todo-package",
    notes: "Verify build and studio dev",
    details: null,
    url: "https://spacepress.dev",
    priority: "high",
    bucketIds: [3, 11],
    ownerId: 1,
    completedAt: null,
    scheduledAt: null,
    pendingBucket: null,
    blockedBy: null,
    recurringDays: 0,
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-24T10:00:00.000Z",
  },
  {
    id: 102,
    title: "Publish release notes",
    slug: "publish-release-notes",
    notes: null,
    details: null,
    url: null,
    priority: "medium",
    bucketIds: [5, 11],
    ownerId: 1,
    completedAt: null,
    scheduledAt: "2026-11-28T09:00:00.000Z",
    pendingBucket: "now",
    blockedBy: 101,
    recurringDays: 0,
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-24T09:00:00.000Z",
  },
  {
    id: 103,
    title: "Already done",
    slug: "already-done",
    notes: null,
    details: null,
    url: null,
    priority: "none",
    bucketIds: [3],
    ownerId: 1,
    completedAt: "2026-11-23T18:00:00.000Z",
    scheduledAt: null,
    pendingBucket: null,
    blockedBy: null,
    recurringDays: 0,
    createdAt: "2026-11-19T09:00:00.000Z",
    updatedAt: "2026-11-23T18:00:00.000Z",
  },
];

test("replaceStatusBucket swaps status while preserving PARA buckets", () => {
  const statusIds = statusBucketIds(buckets);
  assert.deepEqual(statusIds, [2, 3, 4, 5]);
  assert.deepEqual(replaceStatusBucket([3, 11], statusIds, 4), [4, 11]);
  assert.deepEqual(replaceStatusBucket([3, 11], statusIds, null), [11]);
  assert.deepEqual(appendBucketUnique([11], 3), [11, 3]);
  assert.deepEqual(removeBucketId([3, 11], 3), [11]);
  assert.equal(taskStatusSlug(tasks[0], buckets), "now");
});

test("computeTodoViewCounts and filterTasksForView classify tasks accurately", () => {
  const counts = computeTodoViewCounts(tasks, buckets);
  assert.deepEqual(counts, {
    now: 1,
    inbox: 0,
    followUp: 0,
    later: 1,
    scheduled: 1,
    blocked: 1,
    all: 2,
    done: 1,
  });

  assert.deepEqual(
    filterTasksForView(tasks, buckets, "now", null, null).map((t) => t.id),
    [101],
  );
  assert.deepEqual(
    filterTasksForView(tasks, buckets, "blocked", null, null).map((t) => t.id),
    [102],
  );
  assert.deepEqual(
    filterTasksForView(tasks, buckets, "done", null, null).map((t) => t.id),
    [103],
  );
  assert.deepEqual(
    filterTasksForView(tasks, buckets, "now", "spacepress", null).map((t) => t.id),
    [101, 102],
  );
  assert.deepEqual(
    filterTasksForView(tasks, buckets, "all", null, "release").map((t) => t.id),
    [102],
  );
});

test("schedule and recurrence helpers compute timestamps and labels", () => {
  assert.equal(parseDateInputToIso("2026-12-01"), "2026-12-01T09:00:00.000Z");
  assert.equal(
    computeNextOccurrenceIso("2026-11-25T10:00:00.000Z", 7),
    "2026-12-02T10:00:00.000Z",
  );
  assert.equal(
    computeScheduleDelaySeconds("2026-11-25T10:05:00.000Z", Date.parse("2026-11-25T10:00:00.000Z")),
    300,
  );
  assert.equal(formatScheduleLabel("2026-11-25T09:00:00.000Z", "2026-11-25"), "Today");
  assert.equal(formatScheduleLabel("2026-11-26T09:00:00.000Z", "2026-11-25"), "Tomorrow");
  assert.equal(formatScheduleLabel("2026-11-23T09:00:00.000Z", "2026-11-25"), "2d overdue");
  assert.equal(isScheduleOverdue("2026-11-24T09:00:00.000Z", "2026-11-25"), true);
  assert.equal(isScheduleOverdue("2026-11-25T09:00:00.000Z", "2026-11-25"), false);
});
