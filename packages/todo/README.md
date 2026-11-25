# `@spacepress/todo`

Reusable GTD + PARA task and Kanban board module for [SpacePress](https://spacepress.dev) apps.

## What it provides

- **WordPress-native data model (`./schema`):**
  - `createTodoBuckets()` — a hierarchical WordPress `taxonomy()` with `kind` (`status`, `project`, `area`, `resource`), `color`, and `sortOrder`. Workflow statuses (`inbox`, `now`, `follow-up`, `later`) and PARA buckets live in the same vocabulary, or a host app can pass its own shared taxonomy into `createTasksCollection({ buckets })`.
  - `createTasksCollection({ buckets, anonymousRead? })` — a WordPress `collection()` with `revisions`, `softDelete`, native WordPress `comments`, private-by-default or team-shared `access` (plus optional `anonymousRead: true` for read-only public/demo previews while writes stay authenticated), optional `assigneeId`, `repeater()` subtask `checklist`, `completedAt`, `scheduledAt` + `pendingBucket`, self-referencing `blockedBy`, and `recurringDays`.
  - `createTodoSettings()` — workspace global settings (`workspaceName`, `tagline`, `defaultLayout`, `defaultBoardGroup`).
- **Pure domain helpers (`./domain`):**
  - Generic taxonomy bucket transitions (`replaceKindBucket`, `replaceStatusBucket`, `appendBucketUnique`, `removeBucketId`, `bucketIdsForKind`)
  - Dynamic Kanban grouping across any taxonomy kind or priority (`buildKanbanColumns`)
  - Subtask progress & collaborator helpers (`checklistProgress`, `userInitials`)
  - Scheduling & recurrence helpers (`parseDateInputToIso`, `computeNextOccurrenceIso`, `computeSnoozeIso`, `computeScheduleDelaySeconds`, `formatScheduleLabel`, `isScheduleOverdue`)
  - View filtering, sorting, and live count helpers (`filterTasksForView`, `computeTodoViewCounts`, `isTaskBlocked`, `viewMeta`)

## Usage in a SpacePress app

```ts
// sp/schema.ts
import { createTasksCollection, createTodoBuckets, createTodoSettings } from "@spacepress/todo";

export const buckets = createTodoBuckets({ sync: "content/buckets/*.md" });
export const tasks = createTasksCollection({ buckets, sync: "content/tasks/*.md" });
export const settings = createTodoSettings();
```

See [`examples/todo`](../../examples/todo) for a complete shell application wired to `@spacepress/todo`, including List & Kanban Board views, drag-and-drop across any taxonomy group, interactive subtask checklists, team visibility & assignees, Action Scheduler jobs, SpacePress Admin screens, and starter seed data.
