// Reusable SpacePress schema factories for @spacepress/todo.
// Host apps call createTodoBuckets() / createTasksCollection() in sp/schema.ts,
// or pass their own shared hierarchical taxonomy into createTasksCollection({ buckets }).
import {
  type AnyCollection,
  boolean,
  collection,
  global,
  HttpError,
  integer,
  ref,
  repeater,
  richText,
  select,
  slug,
  taxonomy,
  terms,
  text,
  timestamp,
  url,
} from "spacepress";
import {
  TODO_BOARD_GROUPS,
  TODO_BUCKET_KINDS,
  TODO_LAYOUTS,
  TODO_PRIORITIES,
  TODO_STATUS_SLUGS,
  TODO_VISIBILITIES,
} from "./domain";

export interface TodoBucketsOptions {
  label?: string;
  sync?: `${string}/*.md` | `${string}/*.json`;
}

export function createTodoBuckets(options: TodoBucketsOptions = {}) {
  return taxonomy(
    {
      kind: select(TODO_BUCKET_KINDS).default("project"),
      color: text()
        .pattern(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .ui({ label: "Accent color" }),
      sortOrder: integer().default(0).ui({ label: "Sort order" }),
    },
    {
      label: options.label ?? "Buckets",
      hierarchical: true,
      sync: options.sync,
      access: {
        read: "anyone",
        create: "authenticated",
        update: "authenticated",
        delete: "editor",
      },
    },
  );
}

export type TodoBucketsKind = ReturnType<typeof createTodoBuckets>;

export interface TodoTasksOptions<TBuckets = TodoBucketsKind> {
  /** Hierarchical taxonomy for workflow statuses (`inbox`/`now`/`later`/`follow-up`) and PARA (`project`/`area`/`resource`). */
  buckets: TBuckets;
  label?: string;
  url?: `/${string}`;
  sync?: `${string}/*.md` | `${string}/*.json`;
  /** Allow signed-out visitors read-only access to shared (`visibility: "team"`) tasks for public demos. Private tasks stay hidden from anonymous visitors, and all writes stay authenticated. Defaults to `false`. */
  anonymousRead?: boolean;
}

export function createTasksCollection<TBuckets extends TodoBucketsKind = TodoBucketsKind>(
  options: TodoTasksOptions<TBuckets>,
): AnyCollection {
  const tasks: AnyCollection = collection(
    {
      title: text().min(1).max(240).ui({ label: "Task" }),
      slug: slug({ source: "title" }).optional(),
      notes: text({ multiline: true }).max(600).optional().ui({ label: "Short notes" }),
      details: richText().optional().ui({ label: "Details" }),
      url: url().optional().ui({ label: "Action URL" }),
      priority: select(TODO_PRIORITIES).default("none").ui({ label: "Priority" }),
      visibility: select(TODO_VISIBILITIES).default("private").ui({ label: "Visibility" }),
      assigneeId: integer().optional().ui({ label: "Assignee" }),
      checklist: repeater({
        label: text().min(1).max(200),
        done: boolean().default(false),
      })
        .optional()
        .ui({ label: "Checklist" }),
      bucketIds: terms(options.buckets).reverse("tasks").ui({ label: "Buckets & tags" }),
      ownerId: integer()
        .default(1)
        .access({ create: false, update: false })
        .ui({ label: "Owner", help: "Assigned automatically from your WordPress account." }),
      completedAt: timestamp().optional().ui({ label: "Completed at" }),
      scheduledAt: timestamp().optional().ui({ label: "Scheduled for" }),
      pendingBucket: select(TODO_STATUS_SLUGS).optional().ui({ label: "Promote to" }),
      blockedBy: ref((): AnyCollection => tasks)
        .optional()
        .onDelete("setNull")
        .reverse("blocking")
        .ui({ label: "Blocked by" }),
      recurringDays: integer().min(0).max(3650).default(0).ui({ label: "Repeat every (days)" }),
      createdAt: timestamp().defaultNow(),
      updatedAt: timestamp()
        .defaultNow()
        .$onUpdate(() => new Date()),
    },
    {
      label: options.label ?? "Tasks",
      title: "title",
      content: "details",
      url: options.url ?? "/tasks/:slug",
      comments: { guests: false, moderation: "none", threaded: false },
      revisions: true,
      softDelete: true,
      sync: options.sync,
      access: {
        read: options.anonymousRead
          ? (ctx) => {
              if (!ctx.user) return { visibility: "team" };
              if (ctx.user.role === "admin") return true;
              return {
                OR: [{ ownerId: ctx.user.id }, { assigneeId: ctx.user.id }, { visibility: "team" }],
              };
            }
          : (ctx) => {
              if (!ctx.user) return { ownerId: -1 };
              if (ctx.user.role === "admin") return true;
              return {
                OR: [{ ownerId: ctx.user.id }, { assigneeId: ctx.user.id }, { visibility: "team" }],
              };
            },
        create: "authenticated",
        update: (ctx) => {
          if (!ctx.user) return { ownerId: -1 };
          if (ctx.user.role === "admin") return true;
          return {
            OR: [{ ownerId: ctx.user.id }, { assigneeId: ctx.user.id }, { visibility: "team" }],
          };
        },
        delete: (ctx) => {
          if (!ctx.user) return { ownerId: -1 };
          return ctx.user.role === "admin" ? true : { ownerId: ctx.user.id };
        },
      },
    },
  ).on({
    beforeCreate(data, ctx) {
      if (typeof data.title === "string") {
        const cleanTitle = data.title.trim();
        if (typeof cleanTitle === "string") {
          data.title = cleanTitle;
          if (cleanTitle === "") {
            throw new HttpError(422, "invalid_input", "Enter a task title.", "/title");
          }
        }
      }
      if (ctx.user && typeof ctx.user.id === "number") {
        data.ownerId = ctx.user.id;
      }
      if (typeof data.notes === "string") {
        const trimmed = data.notes.trim();
        if (typeof trimmed === "string") {
          data.notes = trimmed === "" ? null : trimmed;
        }
      }
    },
    beforeUpdate(patch, existing) {
      if (typeof patch.title === "string") {
        const cleanTitle = patch.title.trim();
        if (typeof cleanTitle === "string") {
          patch.title = cleanTitle;
          if (cleanTitle === "") {
            throw new HttpError(422, "invalid_input", "Task title cannot be empty.", "/title");
          }
        }
      }
      if (typeof patch.notes === "string") {
        const trimmed = patch.notes.trim();
        if (typeof trimmed === "string") {
          patch.notes = trimmed === "" ? null : trimmed;
        }
      }
      if (patch.blockedBy !== undefined && patch.blockedBy !== null && patch.blockedBy === existing.id) {
        throw new HttpError(422, "invalid_input", "A task cannot block itself.", "/blockedBy");
      }
    },
  });

  return tasks;
}

export function createTodoSettings() {
  return global(
    {
      workspaceName: text().default("Todo"),
      tagline: text().default("Tasks, checklists, and boards powered by SpacePress"),
      defaultLayout: select(TODO_LAYOUTS).default("list"),
      defaultBoardGroup: select(TODO_BOARD_GROUPS).default("status"),
      showCompletedInSidebar: boolean().default(true),
    },
    {
      label: "Todo Settings",
      access: { read: "anyone", update: "admin" },
    },
  );
}
