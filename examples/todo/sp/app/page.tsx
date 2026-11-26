import { db, integer, text } from "spacepress";
import { get_current_user_id, get_post, get_userdata, home_url, is_user_logged_in, wp_login_url } from "php/wordpress";
import { buckets, tasks } from "spacepress:db";
import { Comments, Link, Live, useFormState, type PageProps } from "spacepress/app";
import { ChecklistEditor } from "../components/ChecklistEditor";
import { KanbanDragController } from "../components/KanbanDragController";
import { LiveWorkspacePulse } from "../components/LiveWorkspacePulse";
import { ParaBucketPicker } from "../components/ParaBucketPicker";
import { TaskCheckButton } from "../components/TaskCheckButton";
import { TodoShortcuts } from "../components/TodoShortcuts";
import {
  asBoardGroup,
  asBucketKind,
  asLayout,
  asOptionalFlagFilter,
  asOptionalPriority,
  asOptionalStatusSlug,
  asTodoView,
  buildKanbanColumns,
  checklistProgress,
  computeTodoViewCounts,
  decodeWpText,
  filterTasksForView,
  formatScheduleLabel,
  isScheduleOverdue,
  taskHasBucketSlug,
  taskParaBuckets,
  taskStatusSlug,
  userInitials,
  viewMeta,
  type TodoBoardGroup,
  type TodoBucket,
  type TodoFlagFilter,
  type TodoLayout,
  type TodoPriority,
  type TodoTask,
  type TodoView,
} from "../lib/todo";
import {
  completeAndStopRecurring,
  createBucket,
  createTask,
  deleteTask,
  moveTaskBucket,
  moveTaskColumn,
  snoozeTask,
  toggleTask,
  updateTask,
} from "../server";

export const search = {
  view: text().optional(),
  bucket: text().optional(),
  q: text().optional(),
  task: integer().optional(),
  layout: text().optional(),
  groupBy: text().optional(),
  priority: text().optional(),
  flag: text().optional(),
  showDone: text().optional(),
};

export const metadata = { title: "Workspace" };

interface QueryState {
  view?: string;
  bucket?: string;
  q?: string;
  task?: number;
  layout?: string;
  groupBy?: string;
  priority?: string;
  flag?: string;
  showDone?: string;
}

function buildQuery(params: QueryState): string {
  const parts: string[] = [];
  if (params.view) parts.push(`view=${encodeURIComponent(params.view)}`);
  if (params.bucket) parts.push(`bucket=${encodeURIComponent(params.bucket)}`);
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
  if (params.layout) parts.push(`layout=${encodeURIComponent(params.layout)}`);
  if (params.groupBy) parts.push(`groupBy=${encodeURIComponent(params.groupBy)}`);
  if (params.priority) parts.push(`priority=${encodeURIComponent(params.priority)}`);
  if (params.flag) parts.push(`flag=${encodeURIComponent(params.flag)}`);
  if (params.showDone === "1") parts.push("showDone=1");
  if (params.task && params.task > 0) parts.push(`task=${params.task}`);
  return parts.join("&");
}

function resolveUserLabel(userId: number | null): { name: string; initials: string } | null {
  if (userId === null || userId <= 0) return null;
  const data = get_userdata(userId);
  if (data === false) return null;
  return { name: data.display_name, initials: userInitials(data.display_name) };
}

function commentCountFor(taskId: number): number {
  const post = get_post(taskId);
  if (!post) return 0;
  const n = Number.parseInt(post.comment_count, 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export default async function TodoWorkspacePage({
  search,
}: PageProps<
  "/",
  {
    view?: string;
    bucket?: string;
    q?: string;
    task?: number;
    layout?: string;
    groupBy?: string;
    priority?: string;
    flag?: string;
    showDone?: string;
  }
>) {
  const settings = await db.globals.settings.get();
  const activeView: TodoView = asTodoView(search.view);
  const activeBucketSlug = search.bucket && search.bucket.trim() !== "" ? search.bucket.trim() : null;
  const queryText = search.q && search.q.trim() !== "" ? search.q.trim() : null;
  const selectedTaskId = search.task ?? null;
  const activeLayout: TodoLayout = asLayout(search.layout, asLayout(settings.defaultLayout, "list"));
  const boardGroup: TodoBoardGroup = asBoardGroup(
    search.groupBy,
    asBoardGroup(settings.defaultBoardGroup, "status"),
  );
  const priorityFilter: TodoPriority | null = asOptionalPriority(search.priority);
  const flagFilter: TodoFlagFilter | null = asOptionalFlagFilter(search.flag);
  const showDoneColumn = search.showDone === "1";

  const signedIn = is_user_logged_in();
  const currentUserId = signedIn ? get_current_user_id() : 0;
  const currentUser = signedIn ? get_userdata(currentUserId) : false;
  const currentUserName = currentUser !== false ? currentUser.display_name : "Me";
  const loginHref = wp_login_url(home_url("/"));

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

  const PAGE_SIZE = 250;
  const firstBatch = await tasks.list({ orderBy: { updatedAt: "desc" }, limit: PAGE_SIZE, offset: 0 });
  const rawTasks = [...firstBatch];
  let offset = PAGE_SIZE;
  let lastCount = firstBatch.length;
  while (lastCount === PAGE_SIZE) {
    const batch = await tasks.list({ orderBy: { updatedAt: "desc" }, limit: PAGE_SIZE, offset });
    for (const row of batch) rawTasks.push(row);
    lastCount = batch.length;
    offset += PAGE_SIZE;
  }
  const allTasks: TodoTask[] = rawTasks.map((row) => ({
    id: row.id,
    title: decodeWpText(row.title),
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

  const counts = computeTodoViewCounts(allTasks, allBuckets);
  const todayYmd = new Date().toISOString().slice(0, 10);
  const openTasks = allTasks.filter((t) => t.completedAt === null);

  // In Board mode, show tasks across the whole scope (or active bucket / team view) so columns
  // always display cards side-by-side instead of filtering to a single status bucket.
  const boardScopeView: TodoView =
    activeLayout === "board" &&
    activeBucketSlug === null &&
    (activeView === "now" || activeView === "inbox" || activeView === "follow-up" || activeView === "later")
      ? "all"
      : activeView;

  const visibleTasks = filterTasksForView(
    allTasks,
    allBuckets,
    activeLayout === "board" ? boardScopeView : activeView,
    activeBucketSlug,
    queryText,
    priorityFilter,
    flagFilter,
  );

  // For the optional Completed column on the Kanban board, include matching completed tasks too.
  // When already in `view=done`, `visibleTasks` already holds the matching completed tasks.
  const effectiveShowDone = showDoneColumn || activeView === "done";
  const boardPool: TodoTask[] =
    activeLayout === "board" && effectiveShowDone && activeView !== "done"
      ? [
          ...visibleTasks,
          ...filterTasksForView(
            allTasks,
            allBuckets,
            "done",
            null,
            queryText,
            priorityFilter,
            flagFilter,
          ).filter((t) =>
            activeBucketSlug === null ? true : taskHasBucketSlug(t, allBuckets, activeBucketSlug),
          ),
        ]
      : visibleTasks;

  const kanbanColumns =
    activeLayout === "board" ? buildKanbanColumns(boardPool, allBuckets, boardGroup, effectiveShowDone) : [];

  const statusBuckets = allBuckets.filter((b) => b.kind === "status" && b.parent > 0);
  const paraBuckets = allBuckets.filter((b) => b.kind !== "status" && b.parent > 0);
  const projectBuckets = paraBuckets.filter((b) => b.kind === "project");
  const areaBuckets = paraBuckets.filter((b) => b.kind === "area");
  const resourceBuckets = paraBuckets.filter((b) => b.kind === "resource");

  const activeBucket = activeBucketSlug
    ? allBuckets.find((b) => b.slug === activeBucketSlug) ?? null
    : null;
  const meta = viewMeta(activeView);
  const headerTitle = activeBucket
    ? activeBucket.name
    : activeLayout === "board" && boardScopeView === "all"
      ? "Board"
      : meta.title;
  const headerSubtitle = activeBucket
    ? activeView === "done"
      ? `Completed tasks in ${activeBucket.name} (${activeBucket.kind}).`
      : `Open tasks in ${activeBucket.name} (${activeBucket.kind}).`
    : activeLayout === "board" && boardScopeView === "all"
      ? signedIn
        ? "Drag cards across any taxonomy group — Status, Project, Area, Resource, or Priority."
        : "Browse cards across any taxonomy group — Status, Project, Area, Resource, or Priority."
      : meta.subtitle;

  let selectedRawTask = selectedTaskId
    ? rawTasks.find((t) => t.id === selectedTaskId) ?? null
    : null;
  if (selectedTaskId !== null && selectedRawTask === null) {
    selectedRawTask = await tasks.get(selectedTaskId);
  }
  const selectedTask: TodoTask | null = selectedRawTask
    ? {
        id: selectedRawTask.id,
        title: decodeWpText(selectedRawTask.title),
        slug: selectedRawTask.slug ?? "",
        notes: selectedRawTask.notes ?? null,
        details: selectedRawTask.details ?? null,
        url: selectedRawTask.url ?? null,
        priority: selectedRawTask.priority,
        visibility: selectedRawTask.visibility,
        assigneeId: selectedRawTask.assigneeId ?? null,
        checklist: selectedRawTask.checklist ?? [],
        bucketIds: selectedRawTask.bucketIds,
        ownerId: selectedRawTask.ownerId,
        completedAt: selectedRawTask.completedAt ?? null,
        scheduledAt: selectedRawTask.scheduledAt ?? null,
        pendingBucket: asOptionalStatusSlug(selectedRawTask.pendingBucket),
        blockedBy: selectedRawTask.blockedBy ?? null,
        recurringDays: selectedRawTask.recurringDays,
        createdAt: selectedRawTask.createdAt,
        updatedAt: selectedRawTask.updatedAt,
      }
    : null;
  const currentBlockerOutsideCandidates =
    selectedTask !== null &&
    selectedTask.blockedBy !== null &&
    !openTasks.some((t) => t.id === selectedTask.blockedBy)
      ? await tasks.get(selectedTask.blockedBy)
      : null;

  const baseState: QueryState = {
    view: activeView,
    bucket: activeBucketSlug ?? undefined,
    q: queryText ?? undefined,
    layout: activeLayout,
    groupBy: boardGroup,
    priority: priorityFilter ?? undefined,
    flag: flagFilter ?? undefined,
    showDone: showDoneColumn ? "1" : undefined,
  };

  const closeInspectorQuery = buildQuery(baseState);

  const navItems: { view: TodoView; label: string; icon: string; count: number; color: string }[] = [
    { view: "now", label: "Now", icon: "★", count: counts.now, color: "#f59e0b" },
    { view: "inbox", label: "Inbox", icon: "▤", count: counts.inbox, color: "#3b82f6" },
    { view: "follow-up", label: "Follow-up", icon: "↗", count: counts.followUp, color: "#8b5cf6" },
    { view: "later", label: "Later", icon: "◷", count: counts.later, color: "#64748b" },
    { view: "scheduled", label: "Scheduled", icon: "◫", count: counts.scheduled, color: "#e11d48" },
    { view: "blocked", label: "Blocked", icon: "⊘", count: counts.blocked, color: "#ea580c" },
    { view: "team", label: "Shared with Team", icon: "◈", count: counts.team, color: "#0891b2" },
    { view: "all", label: "All Open", icon: "☰", count: counts.all, color: "#0ea5e9" },
    { view: "done", label: "Completed", icon: "✓", count: counts.done, color: "#10b981" },
  ];

  const groupOptions: { key: TodoBoardGroup; label: string }[] = [
    { key: "status", label: "Status" },
    { key: "project", label: "Project" },
    { key: "area", label: "Area" },
    { key: "resource", label: "Resource" },
    { key: "priority", label: "Priority" },
  ];

  const priorityOptions: { key: TodoPriority; label: string }[] = [
    { key: "high", label: "High" },
    { key: "medium", label: "Medium" },
    { key: "low", label: "Low" },
  ];

  const flagOptions: { key: TodoFlagFilter; label: string }[] = [
    { key: "team", label: "Team" },
    { key: "blocked", label: "Blocked" },
    { key: "recurring", label: "Recurring" },
    { key: "scheduled", label: "Scheduled" },
  ];

  const hasActiveFilters = priorityFilter !== null || flagFilter !== null || queryText !== null;

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
  const selectedChecklistItems = selectedTask
    ? selectedTask.checklist.map((entry, index) => ({
        index,
        label: entry.label,
        done: entry.done,
      }))
    : [];

  const workspaceClass =
    selectedTask !== null
      ? activeLayout === "board"
        ? "todo-workspace todo-workspace--board todo-workspace--inspecting"
        : "todo-workspace todo-workspace--inspecting"
      : activeLayout === "board"
        ? "todo-workspace todo-workspace--board"
        : "todo-workspace";

  return (
    <div className={workspaceClass}>
      {/* Left Navigation Rail */}
      <aside className="todo-sidebar" aria-label="Views and taxonomy buckets">
        <div className="todo-sidebar__head">
          <span className="todo-sidebar__label">Workspace</span>
          <LiveWorkspacePulse initialOpen={counts.all} />
        </div>

        <nav className="todo-nav" aria-label="Views">
          {navItems.map((entry) => {
            const isCurrent = activeBucketSlug === null && activeView === entry.view;
            return (
              <Link
                key={entry.view}
                href={`/?${buildQuery({ view: entry.view, layout: activeLayout, groupBy: boardGroup })}`}
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
                  href={`/?${buildQuery({ bucket: bucket.slug, layout: activeLayout, groupBy: boardGroup })}`}
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
                  href={`/?${buildQuery({ bucket: bucket.slug, layout: activeLayout, groupBy: boardGroup })}`}
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
                  href={`/?${buildQuery({ bucket: bucket.slug, layout: activeLayout, groupBy: boardGroup })}`}
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

        {signedIn && (
          <details className="todo-new-bucket">
            <summary>+ New column, project or area</summary>
            <form action={createBucket} className="todo-new-bucket__form">
              <input
                name="name"
                placeholder="Bucket or column name"
                className="field-input"
                required
                maxLength={80}
              />
              <select name="kind" className="field-select">
                <option value="project" selected>Project</option>
                <option value="area">Area</option>
                <option value="resource">Resource</option>
                <option value="status">Status column</option>
              </select>
              <button className="btn btn--subtle btn--xs">Create bucket</button>
              {bucketState.error && <p className="form-banner form-banner--error">{bucketState.error.message}</p>}
            </form>
          </details>
        )}

        <div className="todo-sidebar__footer">
          <TodoShortcuts hasInspector={selectedTask !== null} />
          {signedIn && (
            <a href="/wp-admin/new/screens/todo-admin-screen" className="sp-topbar__link">DataViews ↗</a>
          )}
        </div>
      </aside>

      {/* Main Workspace Canvas */}
      <main className={activeLayout === "board" ? "todo-main todo-main--board" : "todo-main"}>
        <header className="todo-header">
          <div>
            <div className="todo-header__title-row">
              <h1 className="todo-header__title">{headerTitle}</h1>
              <span className="todo-header__pill">{visibleTasks.length}</span>
            </div>
            <p className="todo-header__subtitle">{headerSubtitle}</p>
          </div>

          <div className="todo-header__right">
            {/* List | Board Segmented Switcher */}
            <div className="segmented" role="group" aria-label="View layout">
              <Link
                href={`/?${buildQuery({ ...baseState, layout: "list" })}`}
                className={activeLayout === "list" ? "segmented__btn segmented__btn--active" : "segmented__btn"}
              >
                ☰ List
              </Link>
              <Link
                href={`/?${buildQuery({ ...baseState, layout: "board" })}`}
                className={activeLayout === "board" ? "segmented__btn segmented__btn--active" : "segmented__btn"}
              >
                ▥ Board
              </Link>
            </div>

            <form method="get" action="/" className="todo-search">
              <input type="hidden" name="view" value={activeView} />
              <input type="hidden" name="layout" value={activeLayout} />
              <input type="hidden" name="groupBy" value={boardGroup} />
              {activeBucketSlug && <input type="hidden" name="bucket" value={activeBucketSlug} />}
              {priorityFilter && <input type="hidden" name="priority" value={priorityFilter} />}
              {flagFilter && <input type="hidden" name="flag" value={flagFilter} />}
              {showDoneColumn && <input type="hidden" name="showDone" value="1" />}
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
                  href={`/?${buildQuery({ ...baseState, q: undefined })}`}
                  className="todo-search__clear"
                >
                  Clear
                </Link>
              )}
            </form>
          </div>
        </header>

        {/* Board Controls + Filter Pills */}
        <div className="toolbar">
          {activeLayout === "board" && (
            <div className="toolbar__group" aria-label="Group Kanban columns by taxonomy">
              <span className="toolbar__label">Columns:</span>
              {groupOptions.map((opt) => (
                <Link
                  key={opt.key}
                  href={`/?${buildQuery({ ...baseState, layout: "board", groupBy: opt.key })}`}
                  className={boardGroup === opt.key ? "filter-pill filter-pill--active" : "filter-pill"}
                >
                  {opt.label}
                </Link>
              ))}
              <Link
                href={`/?${buildQuery({ ...baseState, layout: "board", showDone: showDoneColumn ? undefined : "1" })}`}
                className={showDoneColumn ? "filter-pill filter-pill--active" : "filter-pill"}
              >
                {showDoneColumn ? "✓ Done column" : "+ Done column"}
              </Link>
              {signedIn && <KanbanDragController groupBy={boardGroup} />}
            </div>
          )}

          <div className="toolbar__group" aria-label="Filter by priority or state">
            <span className="toolbar__label">Filter:</span>
            {priorityOptions.map((opt) => {
              const isOn = priorityFilter === opt.key;
              return (
                <Link
                  key={opt.key}
                  href={`/?${buildQuery({ ...baseState, priority: isOn ? undefined : opt.key })}`}
                  className={isOn ? "filter-pill filter-pill--active" : "filter-pill"}
                >
                  {opt.label}
                </Link>
              );
            })}
            <span className="toolbar__sep" aria-hidden="true" />
            {flagOptions.map((opt) => {
              const isOn = flagFilter === opt.key;
              return (
                <Link
                  key={opt.key}
                  href={`/?${buildQuery({ ...baseState, flag: isOn ? undefined : opt.key })}`}
                  className={isOn ? "filter-pill filter-pill--active" : "filter-pill"}
                >
                  {opt.label}
                </Link>
              );
            })}
            {hasActiveFilters && (
              <Link
                href={`/?${buildQuery({
                  view: activeView,
                  bucket: activeBucketSlug ?? undefined,
                  layout: activeLayout,
                  groupBy: boardGroup,
                  showDone: showDoneColumn ? "1" : undefined,
                })}`}
                className="todo-search__clear"
              >
                Reset
              </Link>
            )}
          </div>
        </div>

        {/* Progressive Quick-Add Composer (or Read-Only Preview Notice) */}
        {signedIn ? (
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
                <select name="statusBucket" className="field-select" aria-label="Status bucket">
                  <option value="inbox" selected={meta.defaultStatus === "inbox"}>Inbox</option>
                  <option value="now" selected={meta.defaultStatus === "now"}>Now</option>
                  <option value="follow-up" selected={meta.defaultStatus === "follow-up"}>Follow-up</option>
                  <option value="later" selected={meta.defaultStatus === "later"}>Later</option>
                </select>
                <select name="priority" className="field-select" aria-label="Priority">
                  <option value="none" selected>No priority</option>
                  <option value="high">High priority</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select name="visibility" className="field-select" aria-label="Visibility">
                  <option value="private" selected={activeView !== "team"}>Private</option>
                  <option value="team" selected={activeView === "team"}>Shared with Team</option>
                </select>
                <select name="paraBucketId" className="field-select" aria-label="Project or area">
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
        ) : (
          <div className="preview-banner" role="note">
            <span>
              <strong>Read-only demo preview.</strong> Sign in to add, edit, check off, or drag tasks.
            </span>
            <a href={loginHref} className="btn btn--primary btn--xs">Sign in to edit</a>
          </div>
        )}

        {/* Feedback Banners */}
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

        {/* Live Workspace Content: List OR Taxonomy-Driven Kanban Board */}
        <Live id="task-list">
          {activeLayout === "board" ? (
            <div className="kanban-board" role="region" aria-label="Kanban board">
              {kanbanColumns.map((col) => {
                const colStatusSlug =
                  boardGroup === "status" && col.bucketId !== null
                    ? statusBuckets.find((b) => b.id === col.bucketId)?.slug ?? "inbox"
                    : "now";
                const colParaId =
                  boardGroup !== "status" && boardGroup !== "priority" && col.bucketId !== null
                    ? String(col.bucketId)
                    : activeBucket
                      ? String(activeBucket.id)
                      : "";
                const colPriority = boardGroup === "priority" && col.priority ? col.priority : "none";

                return (
                  <section
                    key={col.key}
                    className="kanban-col"
                    data-kanban-col="true"
                    data-kanban-bucket-id={col.bucketId !== null ? String(col.bucketId) : ""}
                    data-kanban-priority={col.priority ?? ""}
                    data-kanban-complete={col.isCompleted ? "true" : "false"}
                  >
                    <header className="kanban-col__head">
                      <span className="kanban-col__title">
                        <span
                          className="todo-nav__dot"
                          style={{ backgroundColor: col.color }}
                          aria-hidden="true"
                        />
                        <span>{col.label}</span>
                      </span>
                      <span className="kanban-col__count">{col.tasks.length}</span>
                    </header>

                    <div className="kanban-col__cards">
                      {col.tasks.length === 0 ? (
                        <p className="kanban-col__empty">Drop a card here</p>
                      ) : (
                        col.tasks.map((task) => {
                          const isDone = task.completedAt !== null;
                          const tags = taskParaBuckets(task, allBuckets);
                          const progress = checklistProgress(task.checklist);
                          const assignee = resolveUserLabel(task.assigneeId);
                          const comments = commentCountFor(task.id);
                          const scheduleLabel = formatScheduleLabel(task.scheduledAt, todayYmd);
                          const overdue = !isDone && isScheduleOverdue(task.scheduledAt, todayYmd);
                          const blocker = task.blockedBy
                            ? openTasks.find((candidate) => candidate.id === task.blockedBy) ?? null
                            : null;
                          const inspectQuery = buildQuery({ ...baseState, task: task.id });
                          const isSelected = selectedTask !== null && selectedTask.id === task.id;

                          return (
                            <article
                              key={task.id}
                              draggable={signedIn ? "true" : undefined}
                              data-task-row="true"
                              data-kanban-task-id={String(task.id)}
                              className={
                                isSelected
                                  ? isDone
                                    ? "kanban-card kanban-card--selected kanban-card--done"
                                    : "kanban-card kanban-card--selected"
                                  : isDone
                                    ? "kanban-card kanban-card--done"
                                    : "kanban-card"
                              }
                            >
                              <div className="kanban-card__top">
                                {signedIn ? (
                                  <TaskCheckButton
                                    taskId={task.id}
                                    completed={isDone}
                                    label={isDone ? `Reopen ${task.title}` : `Complete ${task.title}`}
                                  />
                                ) : (
                                  <span
                                    className={isDone ? "todo-check todo-check--done todo-check--readonly" : "todo-check todo-check--readonly"}
                                    aria-hidden="true"
                                  >
                                    {isDone ? <span className="todo-check__mark">✓</span> : null}
                                  </span>
                                )}
                                <Link href={`/?${inspectQuery}`} className="kanban-card__title task-row__title">
                                  {task.title}
                                </Link>
                              </div>

                              {task.notes && <p className="kanban-card__notes">{task.notes}</p>}

                              {progress.total > 0 && (
                                <div className="checklist-meter" title={`${progress.done} of ${progress.total} subtasks done`}>
                                  <span className="checklist-meter__label">
                                    ☑ {progress.done}/{progress.total}
                                  </span>
                                  <span className="checklist-meter__track" aria-hidden="true">
                                    <span
                                      className="checklist-meter__fill"
                                      style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                                    />
                                  </span>
                                </div>
                              )}

                              <div className="kanban-card__footer">
                                <div className="task-row__meta">
                                  {task.priority !== "none" && (
                                    <span className={`chip chip--priority-${task.priority}`}>
                                      {task.priority}
                                    </span>
                                  )}
                                  {task.visibility === "team" && (
                                    <span className="chip chip--team">◈ Team</span>
                                  )}
                                  {tags.map((bucket) => (
                                    <span key={bucket.id} className="chip">
                                      <span
                                        className="chip__dot"
                                        style={{ backgroundColor: bucket.color ?? "#64748b" }}
                                        aria-hidden="true"
                                      />
                                      {bucket.name}
                                    </span>
                                  ))}
                                  {scheduleLabel !== "" && (
                                    <span className={overdue ? "chip chip--overdue" : "chip chip--schedule"}>
                                      ◫ {scheduleLabel}
                                    </span>
                                  )}
                                  {task.recurringDays > 0 && (
                                    <span className="chip">↻ {task.recurringDays}d</span>
                                  )}
                                  {blocker && <span className="chip chip--blocked">⊘ Blocked</span>}
                                  {comments > 0 && <span className="chip">💬 {comments}</span>}
                                </div>
                                {assignee && (
                                  <span className="avatar-badge avatar-badge--xs" title={`Assigned to ${assignee.name}`}>
                                    {assignee.initials}
                                  </span>
                                )}
                              </div>
                            </article>
                          );
                        })
                      )}
                    </div>

                    {signedIn && !col.isCompleted && (
                      <details className="kanban-col__add">
                        <summary>+ Add card</summary>
                        <form action={createTask} className="kanban-col__add-form">
                          <input type="hidden" name="statusBucket" value={colStatusSlug} />
                          <input type="hidden" name="priority" value={colPriority} />
                          {colParaId !== "" && <input type="hidden" name="paraBucketId" value={colParaId} />}
                          <input
                            name="title"
                            className="field-input"
                            placeholder={`Add to ${col.label}…`}
                            required
                            maxLength={240}
                          />
                          <button className="btn btn--primary btn--xs">Add</button>
                        </form>
                      </details>
                    )}
                  </section>
                );
              })}
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon" aria-hidden="true">✓</div>
              <p className="empty-state__title">All clear in {headerTitle}</p>
              <p className="empty-state__copy">
                Press <kbd>N</kbd> to capture a task, switch to Board view, or adjust your filters.
              </p>
            </div>
          ) : (
            <div className="task-list" role="list">
              {visibleTasks.map((task) => {
                const isDone = task.completedAt !== null;
                const status = taskStatusSlug(task, allBuckets);
                const tags = taskParaBuckets(task, allBuckets);
                const progress = checklistProgress(task.checklist);
                const assignee = resolveUserLabel(task.assigneeId);
                const comments = commentCountFor(task.id);
                const blocker = task.blockedBy
                  ? openTasks.find((candidate) => candidate.id === task.blockedBy) ?? null
                  : null;
                const blockingCount = openTasks.filter((candidate) => candidate.blockedBy === task.id).length;
                const scheduleLabel = formatScheduleLabel(task.scheduledAt, todayYmd);
                const overdue = !isDone && isScheduleOverdue(task.scheduledAt, todayYmd);
                const inspectQuery = buildQuery({ ...baseState, task: task.id });
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
                    {signedIn ? (
                      <TaskCheckButton
                        taskId={task.id}
                        completed={isDone}
                        label={isDone ? `Reopen ${task.title}` : `Complete ${task.title}`}
                      />
                    ) : (
                      <span
                        className={isDone ? "todo-check todo-check--done todo-check--readonly" : "todo-check todo-check--readonly"}
                        aria-hidden="true"
                      >
                        {isDone ? <span className="todo-check__mark">✓</span> : null}
                      </span>
                    )}
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
                        {task.visibility === "team" && (
                          <span className="chip chip--team">◈ Team</span>
                        )}
                        {status && (activeView === "all" || activeView === "done" || activeView === "team" || activeBucketSlug !== null) && (
                          <span className="chip">{status}</span>
                        )}
                        {tags.map((bucket) => (
                          <Link
                            key={bucket.id}
                            href={`/?${buildQuery({ bucket: bucket.slug, layout: activeLayout, groupBy: boardGroup })}`}
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
                        {progress.total > 0 && (
                          <span className="chip chip--checklist">
                            ☑ {progress.done}/{progress.total}
                          </span>
                        )}
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
                        {comments > 0 && (
                          <span className="chip">💬 {comments}</span>
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
                      {assignee && (
                        <span className="avatar-badge avatar-badge--xs" title={`Assigned to ${assignee.name}`}>
                          {assignee.initials}
                        </span>
                      )}
                      {signedIn && !isDone && status !== "now" && (
                        <form action={moveTaskBucket} className="inline-form">
                          <input type="hidden" name="id" value={task.id} />
                          <input type="hidden" name="statusBucket" value="now" />
                          <button className="btn btn--subtle btn--xs" title="Move to Now">Now</button>
                        </form>
                      )}
                      {signedIn && !isDone && (
                        <form action={snoozeTask} className="inline-form">
                          <input type="hidden" name="id" value={task.id} />
                          <input type="hidden" name="days" value={1} />
                          <button className="btn btn--subtle btn--xs" title="Snooze 1 day">+1d</button>
                        </form>
                      )}
                      <Link href={`/?${inspectQuery}`} className="btn btn--subtle btn--xs">
                        {signedIn ? "Edit" : "View"}
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
              {selectedTask.visibility === "team" && <span className="chip chip--team">◈ Team</span>}
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

          {signedIn ? (
            <>
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
                    <button className="btn btn--subtle btn--xs">Complete &amp; stop recurring</button>
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

              {/* Interactive Subtask Checklist Island */}
              <ChecklistEditor taskId={selectedTask.id} initialItems={selectedChecklistItems} />

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
                    <select id="edit-status" name="statusBucket" className="field-select">
                      <option value="inbox" selected={selectedStatus === "inbox"}>Inbox</option>
                      <option value="now" selected={selectedStatus === "now"}>Now</option>
                      <option value="follow-up" selected={selectedStatus === "follow-up"}>Follow-up</option>
                      <option value="later" selected={selectedStatus === "later"}>Later</option>
                    </select>
                  </div>
                  <div className="inspector__field">
                    <label className="inspector__label" htmlFor="edit-priority">Priority</label>
                    <select id="edit-priority" name="priority" className="field-select">
                      <option value="none" selected={selectedTask.priority === "none"}>None</option>
                      <option value="low" selected={selectedTask.priority === "low"}>Low</option>
                      <option value="medium" selected={selectedTask.priority === "medium"}>Medium</option>
                      <option value="high" selected={selectedTask.priority === "high"}>High</option>
                    </select>
                  </div>
                </div>

                <div className="inspector__grid">
                  <div className="inspector__field">
                    <label className="inspector__label" htmlFor="edit-visibility">Visibility</label>
                    <select id="edit-visibility" name="visibility" className="field-select">
                      <option value="private" selected={selectedTask.visibility === "private"}>Private</option>
                      <option value="team" selected={selectedTask.visibility === "team"}>Shared with Team</option>
                    </select>
                  </div>
                  <div className="inspector__field">
                    <label className="inspector__label" htmlFor="edit-assignee">Assignee</label>
                    <select id="edit-assignee" name="assigneeId" className="field-select">
                      <option value="" selected={selectedTask.assigneeId === null}>Unassigned</option>
                      <option value={String(currentUserId)} selected={selectedTask.assigneeId === currentUserId}>
                        {currentUserName} (me)
                      </option>
                      {selectedTask.assigneeId !== null && selectedTask.assigneeId !== currentUserId && (
                        <option value={String(selectedTask.assigneeId)} selected>
                          User #{selectedTask.assigneeId}
                        </option>
                      )}
                    </select>
                  </div>
                </div>

                <div className="inspector__field">
                  <span className="inspector__label">Projects, Areas &amp; Resources</span>
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
                    <select id="edit-pending" name="pendingBucket" className="field-select">
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
                    <select id="edit-blocker" name="blockedBy" className="field-select">
                      <option value="" selected={selectedTask.blockedBy === null}>None (unblocked)</option>
                      {selectedTask.blockedBy !== null &&
                        !blockerCandidates.some((c) => c.id === selectedTask.blockedBy) && (
                          <option value={String(selectedTask.blockedBy)} selected>
                            {currentBlockerOutsideCandidates
                              ? decodeWpText(currentBlockerOutsideCandidates.title)
                              : `Task #${selectedTask.blockedBy}`}
                          </option>
                        )}
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

              {/* Progressive Move Helper (for touch / no-JS board fallback) */}
              {activeLayout === "board" && boardGroup !== "priority" && (
                <form action={moveTaskColumn} className="inspector__card">
                  <input type="hidden" name="id" value={selectedTask.id} />
                  <input type="hidden" name="groupBy" value={boardGroup} />
                  <div className="inspector__field">
                    <label className="inspector__label" htmlFor="move-col-select">Move card to column</label>
                    <div className="checklist-add">
                      <select id="move-col-select" name="targetBucketId" className="field-select checklist-add__input">
                        <option value="">Unassigned</option>
                        {allBuckets
                          .filter((b) => b.kind === boardGroup && b.parent > 0)
                          .map((b) => (
                            <option key={b.id} value={String(b.id)} selected={selectedTask.bucketIds.includes(b.id)}>
                              {b.name}
                            </option>
                          ))}
                      </select>
                      <button className="btn btn--subtle btn--xs">Move</button>
                    </div>
                  </div>
                </form>
              )}
            </>
          ) : (
            <>
              <div className="inspector__card">
                <h2 className="inspector-readonly__title">{selectedTask.title}</h2>
                {selectedTask.notes && <p className="inspector-readonly__notes">{selectedTask.notes}</p>}
                <div className="task-row__meta">
                  {selectedTask.priority !== "none" && (
                    <span className={`chip chip--priority-${selectedTask.priority}`}>{selectedTask.priority}</span>
                  )}
                  {taskParaBuckets(selectedTask, allBuckets).map((bucket) => (
                    <span key={bucket.id} className="chip">
                      <span
                        className="chip__dot"
                        style={{ backgroundColor: bucket.color ?? "#64748b" }}
                        aria-hidden="true"
                      />
                      {bucket.name}
                    </span>
                  ))}
                  {selectedTask.scheduledAt && (
                    <span className="chip chip--schedule">◫ {selectedTask.scheduledAt.slice(0, 10)}</span>
                  )}
                  {selectedTask.recurringDays > 0 && (
                    <span className="chip">↻ {selectedTask.recurringDays}d</span>
                  )}
                  {selectedTask.url && (
                    <a href={selectedTask.url} target="_blank" rel="noreferrer" className="chip chip--link">
                      Link ↗
                    </a>
                  )}
                </div>
                <a
                  href={wp_login_url(home_url(`/?${buildQuery({ ...baseState, task: selectedTask.id })}`))}
                  className="btn btn--primary btn--xs"
                >
                  Sign in to edit this task
                </a>
              </div>

              {selectedChecklistItems.length > 0 && (
                <section className="inspector__card checklist-card" aria-label="Subtask checklist">
                  <div className="checklist-card__head">
                    <span className="inspector__label">Checklist</span>
                    <span className="checklist-card__count">
                      {checklistProgress(selectedTask.checklist).done}/{selectedChecklistItems.length}
                    </span>
                  </div>
                  <ul className="checklist-list">
                    {selectedChecklistItems.map((entry) => (
                      <li key={entry.index} className={entry.done ? "checklist-item checklist-item--done" : "checklist-item"}>
                        <span
                          className={entry.done ? "todo-check todo-check--sm todo-check--done todo-check--readonly" : "todo-check todo-check--sm todo-check--readonly"}
                          aria-hidden="true"
                        >
                          <span className="todo-check__mark">{entry.done ? "✓" : ""}</span>
                        </span>
                        <span className="checklist-item__label">{entry.label}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {/* Native WordPress Comments for Task Notes & Discussion */}
          <section className="inspector__comments" aria-label="Task notes and discussion">
            <h2>Notes &amp; Discussion (WordPress Comments)</h2>
            <Comments for={selectedRawTask} />
          </section>
        </aside>
      )}
    </div>
  );
}
