# `@spacepress/todo`

Reusable GTD + PARA task module for [SpacePress](https://spacepress.dev) apps, inspired by [PersonalOS TODO](https://personalos.net/).

## What it provides

- **WordPress-native data model (`./schema`):**
  - `createTodoBuckets()` — a hierarchical WordPress `taxonomy()` with `kind` (`status`, `project`, `area`, `resource`), `color`, and `sortOrder`. Status buckets (`inbox`, `now`, `later`, `follow-up`) and PARA buckets live in the same vocabulary, or a host app can pass its own shared Knowledge taxonomy into `createTasksCollection({ buckets })`.
  - `createTasksCollection({ buckets })` — a WordPress `collection()` with `revisions`, `softDelete`, native WordPress `comments` (for task notes/history), owner-scoped private `access`, `completedAt`, `scheduledAt`, `pendingBucket`, self-referencing `blockedBy`, and `recurringDays`.
  - `createTodoSettings()` — workspace global settings.
- **Pure domain helpers (`./domain`):**
  - Status/PARA bucket helpers (`replaceStatusBucket`, `appendBucketUnique`, `removeBucketId`, `taskStatusSlug`, `taskParaBuckets`)
  - Scheduling & recurrence helpers (`parseDateInputToIso`, `computeNextOccurrenceIso`, `computeSnoozeIso`, `computeScheduleDelaySeconds`, `formatScheduleLabel`, `isScheduleOverdue`)
  - View filtering, sorting, and live count helpers (`filterTasksForView`, `computeTodoViewCounts`, `isTaskBlocked`, `viewMeta`)

## Usage in a SpacePress app

```ts
// sp/schema.ts
import { createTasksCollection, createTodoBuckets, createTodoSettings } from "@spacepress/todo";

export const buckets = createTodoBuckets({ sync: "content/buckets/**/*.md" });
export const tasks = createTasksCollection({ buckets, sync: "content/tasks/*.md" });
export const settings = createTodoSettings();
```

See [`examples/todo`](../../examples/todo) for a complete shell application wired to `@spacepress/todo`, including server actions, Action Scheduler jobs, SpacePress Admin screens, progressive forms, `"use client"` interactive islands, and starter seed data.

## Current SpacePress package boundaries

- SpacePress compiles TypeScript/JavaScript directly from installed packages, while `"use client"` interactive islands currently live in the host app's `sp/components/`.
- Native WordPress comments are enabled on `tasks` and rendered with `<Comments for={task} />`. Programmatic audit comments from server mutations await `wp_insert_comment` / custom `comment_type` support in SpacePress's `"php/wordpress"` bridge.
