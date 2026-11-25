import { integer, text } from "spacepress";
import { buckets, tasks } from "spacepress:db";
import { Comments, Link, Live, useFormState, type PageProps } from "spacepress/app";
import { LiveWorkspacePulse } from "../components/LiveWorkspacePulse";
import { ParaBucketPicker } from "../components/ParaBucketPicker";
import { TaskCheckButton } from "../components/TaskCheckButton";
import { TodoShortcuts } from "../components/TodoShortcuts";
import {
  asBucketKind,
  asOptionalStatusSlug,
  asTodoView,
  computeTodoViewCounts,
  decodeWpText,
  filterTasksForView,
  formatScheduleLabel,
  isScheduleOverdue,
  taskHasBucketSlug,
  taskParaBuckets,
  taskStatusSlug,
  viewMeta,
  type TodoBucket,
  type TodoTask,
  type TodoView,
} from "../lib/todo";
import {
  completeAndStopRecurring,
  createBucket,
  createTask,
  deleteTask,
  moveTaskBucket,
  snoozeTask,
  toggleTask,
  updateTask,
} from "../server";

export const guard = "authenticated";

export const search = {
  view: text().optional(),
  bucket: text().optional(),
  q: text().optional(),
  task: integer().optional(),
};

export const metadata = { title: "Workspace" };

function buildQuery(params: { view?: string; bucket?: string; q?: string; task?: number }): string {
  const parts: string[] = [];
  if (params.view) parts.push(`view=${encodeURIComponent(params.view)}`);
  if (params.bucket) parts.push(`bucket=${encodeURIComponent(params.bucket)}`);
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
  if (params.task && params.task > 0) parts.push(`task=${params.task}`);
  return parts.join("&");
}

export default async function TodoWorkspacePage({
  search,
}: PageProps<"/", { view?: string; bucket?: string; q?: string; task?: number }>) {
  const activeView: TodoView = asTodoView(search.view);
  const activeBucketSlug = search.bucket && search.bucket.trim() !== "" ? search.bucket.trim() : null;
  const queryText = search.q && search.q.trim() !== "" ? search.q.trim() : null;
  const selectedTaskId = search.task ?? null;

  const createState = useFormState(createTask);
  const updateState = useFormState(updateTask);
  const bucketState = useFormState(createBucket);
  const toggleState = useFormState(toggleTask);
  const stopRecurringState = useFormState(completeAndStopRecurring);
  const snoozeState = useFormState(snoozeTask);
  const deleteState = useFormState(deleteTask);

  const rawBuckets = await buckets.system.list({ orderBy: { sortOrder: "asc" }, limit: 200 });
  const allBuckets: TodoBucket[] = rawBuckets.map((row) => ({
    id: row.id,
    name: decodeWpText(row.name),
    slug: row.slug,
    parent: row.parent ?? 0,
    kind: asBucketKind(row.kind) ?? "project",
    color: row.color ?? null,
    sortOrder: row.sortOrder,
  }));

  const rawTasks = await tasks.list({ orderBy: { updatedAt: "desc" }, limit: 250 });
  const allTasks: TodoTask[] = rawTasks.map((row) => ({
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

  const counts = computeTodoViewCounts(allTasks, allBuckets);
  const visibleTasks = filterTasksForView(allTasks, allBuckets, activeView, activeBucketSlug, queryText);
  const todayYmd = new Date().toISOString().slice(0, 10);

  const openTasks = allTasks.filter((t) => t.completedAt === null);
  const paraBuckets = allBuckets.filter((b) => b.kind !== "status" && b.parent > 0);
  const projectBuckets = paraBuckets.filter((b) => b.kind === "project");
  const areaBuckets = paraBuckets.filter((b) => b.kind === "area");
  const resourceBuckets = paraBuckets.filter((b) => b.kind === "resource");

  const activeBucket = activeBucketSlug
    ? allBuckets.find((b) => b.slug === activeBucketSlug) ?? null
    : null;
  const meta = viewMeta(activeView);
  const headerTitle = activeBucket ? activeBucket.name : meta.title;
  const headerSubtitle = activeBucket
    ? `Open tasks tagged with ${activeBucket.name} (${activeBucket.kind}).`
    : meta.subtitle;

  const selectedTask = selectedTaskId
    ? allTasks.find((t) => t.id === selectedTaskId) ?? null
    : null;
  const selectedRawTask = selectedTask
    ? rawTasks.find((t) => t.id === selectedTask.id) ?? null
    : null;

  const closeInspectorQuery = buildQuery({
    view: activeView,
    bucket: activeBucketSlug ?? undefined,
    q: queryText ?? undefined,
  });

  const navItems: { view: TodoView; label: string; icon: string; count: number; color: string }[] = [
    { view: "now", label: "Now", icon: "★", count: counts.now, color: "#f59e0b" },
    { view: "inbox", label: "Inbox", icon: "▤", count: counts.inbox, color: "#3b82f6" },
    { view: "follow-up", label: "Follow-up", icon: "↗", count: counts.followUp, color: "#8b5cf6" },
    { view: "later", label: "Later", icon: "◷", count: counts.later, color: "#64748b" },
    { view: "scheduled", label: "Scheduled", icon: "◫", count: counts.scheduled, color: "#e11d48" },
    { view: "blocked", label: "Blocked", icon: "⊘", count: counts.blocked, color: "#ea580c" },
    { view: "all", label: "All Open", icon: "☰", count: counts.all, color: "#0ea5e9" },
    { view: "done", label: "Completed", icon: "✓", count: counts.done, color: "#10b981" },
  ];

  const selectedStatus = selectedTask ? taskStatusSlug(selectedTask, allBuckets) ?? "inbox" : "inbox";
  const selectedParaIds = selectedTask
    ? taskParaBuckets(selectedTask, allBuckets).map((b) => String(b.id)).join(",")
    : "";
  const selectedPickerBuckets = paraBuckets.map((b) => ({
    id: b.id,
    name: b.name,
    kind: b.kind,
    color: b.color ?? "#64748b",
  }));
  const blockerCandidates = selectedTask
    ? openTasks.filter((t) => t.id !== selectedTask.id)
    : [];

  return (
    <div className={selectedTask ? "todo-workspace todo-workspace--inspecting" : "todo-workspace"}>
      {/* Left Navigation Rail */}
      <aside className="todo-sidebar" aria-label="Views and PARA buckets">
        <div className="todo-sidebar__head">
          <span className="todo-sidebar__label">Workspace</span>
          <LiveWorkspacePulse initialOpen={counts.all} />
        </div>

        <nav className="todo-nav" aria-label="GTD Views">
          {navItems.map((entry) => {
            const isCurrent = activeBucketSlug === null && activeView === entry.view;
            return (
              <Link
                key={entry.view}
                href={`/?${buildQuery({ view: entry.view })}`}
                className={isCurrent ? "todo-nav__item todo-nav__item--active" : "todo-nav__item"}
              >
                <span className="todo-nav__left">
                  <span className="todo-nav__icon" style={{ color: entry.color }} aria-hidden="true">
                    {entry.icon}
                  </span>
                  <span>{entry.label}</span>
                </span>
                <span className="todo-nav__count">{entry.count}</span>
              </Link>
            );
          })}
        </nav>

        {projectBuckets.length > 0 && (
          <div className="todo-nav__section">
            <span className="todo-nav__heading">Projects</span>
            {projectBuckets.map((bucket) => {
              const count = openTasks.filter((t) => taskHasBucketSlug(t, allBuckets, bucket.slug)).length;
              const isCurrent = activeBucketSlug === bucket.slug;
              return (
                <Link
                  key={bucket.id}
                  href={`/?${buildQuery({ bucket: bucket.slug })}`}
                  className={isCurrent ? "todo-nav__item todo-nav__item--active" : "todo-nav__item"}
                >
                  <span className="todo-nav__left">
                    <span className="todo-nav__dot" style={{ backgroundColor: bucket.color ?? "#3b82f6" }} aria-hidden="true" />
                    <span>{bucket.name}</span>
                  </span>
                  <span className="todo-nav__count">{count}</span>
                </Link>
              );
            })}
          </div>
        )}

        {areaBuckets.length > 0 && (
          <div className="todo-nav__section">
            <span className="todo-nav__heading">Areas</span>
            {areaBuckets.map((bucket) => {
              const count = openTasks.filter((t) => taskHasBucketSlug(t, allBuckets, bucket.slug)).length;
              const isCurrent = activeBucketSlug === bucket.slug;
              return (
                <Link
                  key={bucket.id}
                  href={`/?${buildQuery({ bucket: bucket.slug })}`}
                  className={isCurrent ? "todo-nav__item todo-nav__item--active" : "todo-nav__item"}
                >
                  <span className="todo-nav__left">
                    <span className="todo-nav__dot" style={{ backgroundColor: bucket.color ?? "#10b981" }} aria-hidden="true" />
                    <span>{bucket.name}</span>
                  </span>
                  <span className="todo-nav__count">{count}</span>
                </Link>
              );
            })}
          </div>
        )}

        {resourceBuckets.length > 0 && (
          <div className="todo-nav__section">
            <span className="todo-nav__heading">Resources</span>
            {resourceBuckets.map((bucket) => {
              const count = openTasks.filter((t) => taskHasBucketSlug(t, allBuckets, bucket.slug)).length;
              const isCurrent = activeBucketSlug === bucket.slug;
              return (
                <Link
                  key={bucket.id}
                  href={`/?${buildQuery({ bucket: bucket.slug })}`}
                  className={isCurrent ? "todo-nav__item todo-nav__item--active" : "todo-nav__item"}
                >
                  <span className="todo-nav__left">
                    <span className="todo-nav__dot" style={{ backgroundColor: bucket.color ?? "#8b5cf6" }} aria-hidden="true" />
                    <span>{bucket.name}</span>
                  </span>
                  <span className="todo-nav__count">{count}</span>
                </Link>
              );
            })}
          </div>
        )}

        <details className="todo-new-bucket">
          <summary>+ New project or area</summary>
          <form action={createBucket} className="todo-new-bucket__form">
            <input
              name="name"
              placeholder="Bucket name"
              className="field-input"
              required
              maxLength={80}
            />
            <select name="kind" className="field-select">
              <option value="project" selected>Project</option>
              <option value="area">Area</option>
              <option value="resource">Resource</option>
            </select>
            <button className="btn btn--subtle btn--xs">Create bucket</button>
            {bucketState.error && <p className="form-banner form-banner--error">{bucketState.error.message}</p>}
          </form>
        </details>

        <div className="todo-sidebar__footer">
          <TodoShortcuts hasInspector={selectedTask !== null} />
          <a href="/wp-admin/new/screens/todo-admin-screen" className="sp-topbar__link">DataViews ↗</a>
        </div>
      </aside>

      {/* Main Task Workspace */}
      <main className="todo-main">
        <header className="todo-header">
          <div>
            <div className="todo-header__title-row">
              <h1 className="todo-header__title">{headerTitle}</h1>
              <span className="todo-header__pill">{visibleTasks.length}</span>
            </div>
            <p className="todo-header__subtitle">{headerSubtitle}</p>
          </div>
          <form method="get" action="/" className="todo-search">
            {activeView !== "now" && <input type="hidden" name="view" value={activeView} />}
            {activeBucketSlug && <input type="hidden" name="bucket" value={activeBucketSlug} />}
            <input
              id="todo-search-input"
              type="search"
              name="q"
              defaultValue={queryText ?? ""}
              placeholder="Search tasks… (/)"
              className="todo-search__input"
              aria-label="Search tasks"
            />
            {queryText && (
              <Link
                href={`/?${buildQuery({ view: activeView, bucket: activeBucketSlug ?? undefined })}`}
                className="todo-search__clear"
              >
                Clear
              </Link>
            )}
          </form>
        </header>

        {/* Progressive Quick-Add Composer */}
        <form action={createTask} className="quick-add">
          <div className="quick-add__top">
            <span className="quick-add__plus" aria-hidden="true">+</span>
            <input
              id="quick-add-title"
              name="title"
              type="text"
              className="quick-add__title"
              placeholder="New task… press N anywhere to capture"
              required
              maxLength={240}
              defaultValue={createState.values.title ?? ""}
            />
            <button className="btn btn--primary">Add task</button>
          </div>
          <div className="quick-add__controls">
            <div className="quick-add__meta">
              <select
                name="statusBucket"
                className="field-select"
                aria-label="Status bucket"
              >
                <option value="inbox" selected={meta.defaultStatus === "inbox"}>Inbox</option>
                <option value="now" selected={meta.defaultStatus === "now"}>Now</option>
                <option value="follow-up" selected={meta.defaultStatus === "follow-up"}>Follow-up</option>
                <option value="later" selected={meta.defaultStatus === "later"}>Later</option>
              </select>
              <select
                name="priority"
                className="field-select"
                aria-label="Priority"
              >
                <option value="none" selected>No priority</option>
                <option value="high">High priority</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select
                name="paraBucketId"
                className="field-select"
                aria-label="Project or area"
              >
                <option value="" selected={activeBucket === null}>No project / area</option>
                {paraBuckets.map((bucket) => (
                  <option
                    key={bucket.id}
                    value={String(bucket.id)}
                    selected={activeBucket !== null && activeBucket.id === bucket.id}
                  >
                    {bucket.name} ({bucket.kind})
                  </option>
                ))}
              </select>
              <input
                name="scheduledDate"
                type="date"
                className="field-input"
                aria-label="Schedule date"
                title="Schedule date"
              />
            </div>
          </div>
          {createState.error && (
            <p role="alert" className="form-banner form-banner--error">
              {createState.error.message}
            </p>
          )}
          {createState.result && (
            <p role="status" className="form-banner form-banner--ok">
              Added “{createState.result.title}”.
            </p>
          )}
        </form>

        {/* Status feedback from mutations */}
        {toggleState.result && toggleState.result.unblockedCount > 0 && (
          <p role="status" className="form-banner form-banner--ok">
            Completed task and automatically unblocked {toggleState.result.unblockedCount} waiting task(s).
          </p>
        )}
        {stopRecurringState.result && (
          <p role="status" className="form-banner form-banner--ok">
            Completed task and stopped recurrence.
          </p>
        )}
        {snoozeState.result && (
          <p role="status" className="form-banner form-banner--ok">
            Snoozed until {snoozeState.result.scheduledAt.slice(0, 10)}.
          </p>
        )}
        {deleteState.result && (
          <p role="status" className="form-banner form-banner--ok">
            Moved task to trash.
          </p>
        )}

        {/* Live Task List */}
        <Live id="task-list">
          {visibleTasks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon" aria-hidden="true">✓</div>
              <p className="empty-state__title">All clear in {headerTitle}</p>
              <p className="empty-state__copy">
                Press <kbd>N</kbd> to capture a task, or switch buckets on the left.
              </p>
            </div>
          ) : (
            <div className="task-list" role="list">
              {visibleTasks.map((task) => {
                const isDone = task.completedAt !== null;
                const status = taskStatusSlug(task, allBuckets);
                const tags = taskParaBuckets(task, allBuckets);
                const blocker = task.blockedBy
                  ? openTasks.find((candidate) => candidate.id === task.blockedBy) ?? null
                  : null;
                const blockingCount = openTasks.filter((candidate) => candidate.blockedBy === task.id).length;
                const scheduleLabel = formatScheduleLabel(task.scheduledAt, todayYmd);
                const overdue = !isDone && isScheduleOverdue(task.scheduledAt, todayYmd);
                const inspectQuery = buildQuery({
                  view: activeView,
                  bucket: activeBucketSlug ?? undefined,
                  q: queryText ?? undefined,
                  task: task.id,
                });
                const isSelected = selectedTask !== null && selectedTask.id === task.id;
                const rowClass = isSelected
                  ? isDone
                    ? "task-row task-row--selected task-row--done"
                    : "task-row task-row--selected"
                  : isDone
                    ? "task-row task-row--done"
                    : "task-row";

                return (
                  <article key={task.id} className={rowClass} role="listitem" data-task-row="true">
                    <TaskCheckButton
                      taskId={task.id}
                      completed={isDone}
                      label={isDone ? `Reopen ${task.title}` : `Complete ${task.title}`}
                    />
                    <div className="task-row__body">
                      <div className="task-row__top">
                        <Link href={`/?${inspectQuery}`} className="task-row__title">
                          {task.title}
                        </Link>
                      </div>
                      {task.notes && <p className="task-row__notes">{task.notes}</p>}
                      <div className="task-row__meta">
                        {task.priority !== "none" && (
                          <span className={`chip chip--priority-${task.priority}`}>
                            {task.priority}
                          </span>
                        )}
                        {status && (activeView === "all" || activeView === "done" || activeBucketSlug !== null) && (
                          <span className="chip">{status}</span>
                        )}
                        {tags.map((bucket) => (
                          <Link
                            key={bucket.id}
                            href={`/?${buildQuery({ bucket: bucket.slug })}`}
                            className="chip"
                          >
                            <span
                              className="chip__dot"
                              style={{ backgroundColor: bucket.color ?? "#64748b" }}
                              aria-hidden="true"
                            />
                            {bucket.name}
                          </Link>
                        ))}
                        {scheduleLabel !== "" && (
                          <span className={overdue ? "chip chip--overdue" : "chip chip--schedule"}>
                            ◫ {scheduleLabel}
                          </span>
                        )}
                        {task.recurringDays > 0 && (
                          <span className="chip">↻ {task.recurringDays}d</span>
                        )}
                        {blocker && (
                          <span className="chip chip--blocked">⊘ Blocked by {blocker.title}</span>
                        )}
                        {blockingCount > 0 && (
                          <span className="chip chip--blocking">Blocks {blockingCount}</span>
                        )}
                        {task.url && (
                          <a
                            href={task.url}
                            target="_blank"
                            rel="noreferrer"
                            className="chip chip--link"
                          >
                            Link ↗
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="task-row__actions">
                      {!isDone && status !== "now" && (
                        <form action={moveTaskBucket} className="inline-form">
                          <input type="hidden" name="id" value={task.id} />
                          <input type="hidden" name="statusBucket" value="now" />
                          <button className="btn btn--subtle btn--xs" title="Move to Now">Now</button>
                        </form>
                      )}
                      {!isDone && (
                        <form action={snoozeTask} className="inline-form">
                          <input type="hidden" name="id" value={task.id} />
                          <input type="hidden" name="days" value={1} />
                          <button className="btn btn--subtle btn--xs" title="Snooze 1 day">+1d</button>
                        </form>
                      )}
                      <Link href={`/?${inspectQuery}`} className="btn btn--subtle btn--xs">
                        Edit
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Live>
      </main>

      {/* URL-Addressable Slide-Over Task Inspector (?task=<id>) */}
      {selectedTask && selectedRawTask && (
        <aside className="todo-inspector" aria-label="Task inspector">
          <div className="inspector__top">
            <div className="task-row__meta">
              <span className="chip">{selectedTask.completedAt ? "completed" : selectedStatus}</span>
              <Link href={`/tasks/${selectedTask.slug}`} className="chip chip--link">
                Full page ↗
              </Link>
            </div>
            <Link
              id="inspector-close-link"
              href={`/?${closeInspectorQuery}`}
              className="inspector__close"
              title="Close inspector"
            >
              ✕
            </Link>
          </div>

          <div className="inspector__quickbar">
            <form action={toggleTask} className="inline-form">
              <input type="hidden" name="id" value={selectedTask.id} />
              <button className="btn btn--primary btn--xs">
                {selectedTask.completedAt ? "Reopen task" : "Complete"}
              </button>
            </form>
            {selectedTask.completedAt === null && selectedTask.recurringDays > 0 && (
              <form action={completeAndStopRecurring} className="inline-form">
                <input type="hidden" name="id" value={selectedTask.id} />
                <button className="btn btn--subtle btn--xs">Complete & stop recurring</button>
              </form>
            )}
            {selectedTask.completedAt === null && (
              <form action={snoozeTask} className="inline-form">
                <input type="hidden" name="id" value={selectedTask.id} />
                <input type="hidden" name="days" value={7} />
                <button className="btn btn--subtle btn--xs">Snooze +7d</button>
              </form>
            )}
            <form action={deleteTask} className="inline-form">
              <input type="hidden" name="id" value={selectedTask.id} />
              <button className="btn btn--danger btn--xs">Trash</button>
            </form>
          </div>

          <form action={updateTask} className="inspector__card">
            <input type="hidden" name="id" value={selectedTask.id} />

            <div className="inspector__field">
              <label className="inspector__label" htmlFor="edit-title">Title</label>
              <input
                id="edit-title"
                name="title"
                className="field-input"
                required
                maxLength={240}
                defaultValue={selectedTask.title}
              />
            </div>

            <div className="inspector__field">
              <label className="inspector__label" htmlFor="edit-notes">Short notes</label>
              <textarea
                id="edit-notes"
                name="notes"
                className="field-textarea"
                maxLength={600}
                defaultValue={selectedTask.notes ?? ""}
                placeholder="Concise summary shown in the task list…"
              />
            </div>

            <div className="inspector__field">
              <label className="inspector__label" htmlFor="edit-url">Action URL</label>
              <input
                id="edit-url"
                name="url"
                type="url"
                className="field-input"
                defaultValue={selectedTask.url ?? ""}
                placeholder="https://…"
              />
            </div>

            <div className="inspector__grid">
              <div className="inspector__field">
                <label className="inspector__label" htmlFor="edit-status">Status bucket</label>
                <select
                  id="edit-status"
                  name="statusBucket"
                  className="field-select"
                >
                  <option value="inbox" selected={selectedStatus === "inbox"}>Inbox</option>
                  <option value="now" selected={selectedStatus === "now"}>Now</option>
                  <option value="follow-up" selected={selectedStatus === "follow-up"}>Follow-up</option>
                  <option value="later" selected={selectedStatus === "later"}>Later</option>
                </select>
              </div>
              <div className="inspector__field">
                <label className="inspector__label" htmlFor="edit-priority">Priority</label>
                <select
                  id="edit-priority"
                  name="priority"
                  className="field-select"
                >
                  <option value="none" selected={selectedTask.priority === "none"}>None</option>
                  <option value="low" selected={selectedTask.priority === "low"}>Low</option>
                  <option value="medium" selected={selectedTask.priority === "medium"}>Medium</option>
                  <option value="high" selected={selectedTask.priority === "high"}>High</option>
                </select>
              </div>
            </div>

            <div className="inspector__field">
              <span className="inspector__label">Projects, Areas & Resources</span>
              <ParaBucketPicker
                buckets={selectedPickerBuckets}
                initialCsv={selectedParaIds}
              />
            </div>

            <div className="inspector__grid">
              <div className="inspector__field">
                <label className="inspector__label" htmlFor="edit-schedule">Schedule date</label>
                <input
                  id="edit-schedule"
                  name="scheduledDate"
                  type="date"
                  className="field-input"
                  defaultValue={selectedTask.scheduledAt ? selectedTask.scheduledAt.slice(0, 10) : ""}
                />
              </div>
              <div className="inspector__field">
                <label className="inspector__label" htmlFor="edit-pending">Promote to</label>
                <select
                  id="edit-pending"
                  name="pendingBucket"
                  className="field-select"
                >
                  <option value="now" selected={(selectedTask.pendingBucket ?? "now") === "now"}>Now</option>
                  <option value="inbox" selected={selectedTask.pendingBucket === "inbox"}>Inbox</option>
                  <option value="follow-up" selected={selectedTask.pendingBucket === "follow-up"}>Follow-up</option>
                  <option value="later" selected={selectedTask.pendingBucket === "later"}>Later</option>
                </select>
              </div>
            </div>

            <div className="inspector__grid">
              <div className="inspector__field">
                <label className="inspector__label" htmlFor="edit-recurring">Repeat every (days)</label>
                <input
                  id="edit-recurring"
                  name="recurringDays"
                  type="number"
                  min={0}
                  max={3650}
                  className="field-input"
                  defaultValue={selectedTask.recurringDays}
                />
              </div>
              <div className="inspector__field">
                <label className="inspector__label" htmlFor="edit-blocker">Blocked by</label>
                <select
                  id="edit-blocker"
                  name="blockedBy"
                  className="field-select"
                >
                  <option value="" selected={selectedTask.blockedBy === null}>None (unblocked)</option>
                  {blockerCandidates.map((candidate) => (
                    <option
                      key={candidate.id}
                      value={String(candidate.id)}
                      selected={selectedTask.blockedBy === candidate.id}
                    >
                      {candidate.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button className="btn btn--primary">Save changes</button>
            {updateState.error && (
              <p role="alert" className="form-banner form-banner--error">
                {updateState.error.message}
              </p>
            )}
            {updateState.result && (
              <p role="status" className="form-banner form-banner--ok">
                Saved changes.
              </p>
            )}
          </form>

          {/* Native WordPress Comments for Task History & Notes */}
          <section className="inspector__comments" aria-label="Task notes and history">
            <h2>Notes &amp; History (WordPress Comments)</h2>
            <Comments for={selectedRawTask} />
          </section>
        </aside>
      )}
    </div>
  );
}
