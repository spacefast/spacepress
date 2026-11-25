import { get_post, get_userdata, home_url, is_user_logged_in, wp_login_url } from "php/wordpress";
import { buckets, tasks } from "spacepress:db";
import { Comments, Content, Link, notFound, type PageProps } from "spacepress/app";
import { ChecklistEditor } from "../../../components/ChecklistEditor";
import { TaskCheckButton } from "../../../components/TaskCheckButton";
import { checklistProgress, decodeWpText, userInitials } from "../../../lib/todo";
import { completeAndStopRecurring, snoozeTask } from "../../../server";

export const metadata = ({ item }: PageProps<"tasks/[slug]">) => ({
  title: item ? item.title : "Task",
});

export default async function TaskDetailPage({ item }: PageProps<"tasks/[slug]">) {
  if (!item) notFound();

  const signedIn = is_user_logged_in();
  const loginHref = wp_login_url(home_url(`/tasks/${item.slug}`));
  const allBuckets = await buckets.system.list({ orderBy: { sortOrder: "asc" }, limit: 200 });
  const assignedBuckets = allBuckets.filter((b) => item.bucketIds.includes(b.id));
  const blocker = item.blockedBy ? await tasks.get(item.blockedBy) : null;
  const blocking = await tasks.list({
    where: { blockedBy: item.id, completedAt: { isNull: true } },
    limit: 50,
  });
  const assignee = item.assigneeId ? get_userdata(item.assigneeId) : false;
  const wpPost = get_post(item.id);
  const commentCount = wpPost ? Number.parseInt(wpPost.comment_count, 10) || 0 : 0;
  const checklistItems = (item.checklist ?? []).map((entry, index) => ({
    index,
    label: entry.label,
    done: entry.done,
  }));
  const progress = checklistProgress(item.checklist ?? []);

  return (
    <main className="task-detail-page">
      <div>
        <Link href={`/?task=${item.id}`} className="sp-topbar__link">← Back to workspace</Link>
      </div>

      {!signedIn && (
        <div className="preview-banner" role="note">
          <span>
            <strong>Read-only preview.</strong> Sign in to check off subtasks, edit fields, or post comments.
          </span>
          <a href={loginHref} className="btn btn--primary btn--xs">Sign in</a>
        </div>
      )}

      <article className="task-detail-card">
        <div className="task-row__top">
          {signedIn ? (
            <TaskCheckButton
              taskId={item.id}
              completed={item.completedAt !== null}
              label={item.completedAt ? `Reopen ${item.title}` : `Complete ${item.title}`}
            />
          ) : (
            <span
              className={item.completedAt !== null ? "todo-check todo-check--done todo-check--readonly" : "todo-check todo-check--readonly"}
              aria-hidden="true"
            >
              {item.completedAt !== null ? <span className="todo-check__mark">✓</span> : null}
            </span>
          )}
          <h1 className="todo-header__title">{item.title}</h1>
        </div>

        {item.notes && <p className="todo-header__subtitle">{item.notes}</p>}

        <div className="task-row__meta">
          {item.priority !== "none" && (
            <span className={`chip chip--priority-${item.priority}`}>{item.priority}</span>
          )}
          {item.visibility === "team" && <span className="chip chip--team">◈ Team</span>}
          {assignee !== false && (
            <span className="chip">
              <span className="avatar-badge avatar-badge--xs">{userInitials(assignee.display_name)}</span>
              {assignee.display_name}
            </span>
          )}
          {assignedBuckets.map((bucket) => (
            <Link
              key={bucket.id}
              href={bucket.kind === "status" ? `/?view=${bucket.slug}` : `/?bucket=${bucket.slug}`}
              className="chip"
            >
              {decodeWpText(bucket.name)}
            </Link>
          ))}
          {item.scheduledAt && (
            <span className="chip chip--schedule">◫ {item.scheduledAt.slice(0, 10)}</span>
          )}
          {item.recurringDays > 0 && (
            <span className="chip">↻ Every {item.recurringDays} days</span>
          )}
          {commentCount > 0 && <span className="chip">💬 {commentCount}</span>}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="chip chip--link">
              Open link ↗
            </a>
          )}
        </div>

        {blocker && (
          <p className="form-banner form-banner--error">
            Blocked by <Link href={`/tasks/${blocker.slug}`}>{blocker.title}</Link>
          </p>
        )}

        {blocking.length > 0 && (
          <div>
            <span className="inspector__label">Unblocks when completed</span>
            <ul>
              {blocking.map((dep) => (
                <li key={dep.id}>
                  <Link href={`/tasks/${dep.slug}`}>{dep.title}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {item.details && (
          <div>
            <Content value={item.details} />
          </div>
        )}

        <div className="inspector__quickbar">
          <Link href={`/?task=${item.id}`} className="btn btn--subtle btn--xs">
            {signedIn ? "Edit in inspector" : "Open in workspace"}
          </Link>
          {signedIn && item.completedAt === null && item.recurringDays > 0 && (
            <form action={completeAndStopRecurring} className="inline-form">
              <input type="hidden" name="id" value={item.id} />
              <button className="btn btn--subtle btn--xs">Complete &amp; stop recurring</button>
            </form>
          )}
          {signedIn && item.completedAt === null && (
            <form action={snoozeTask} className="inline-form">
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="days" value={1} />
              <button className="btn btn--subtle btn--xs">Snooze +1d</button>
            </form>
          )}
          {!signedIn && (
            <a href={loginHref} className="btn btn--primary btn--xs">Sign in to edit</a>
          )}
        </div>
      </article>

      {signedIn ? (
        <ChecklistEditor taskId={item.id} initialItems={checklistItems} />
      ) : checklistItems.length > 0 ? (
        <section className="inspector__card checklist-card" aria-label="Subtask checklist">
          <div className="checklist-card__head">
            <span className="inspector__label">Checklist</span>
            <span className="checklist-card__count">
              {progress.done}/{progress.total}
            </span>
          </div>
          <ul className="checklist-list">
            {checklistItems.map((entry) => (
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
      ) : null}

      <section className="inspector__comments" aria-label="Task notes and history">
        <h2>Notes &amp; Discussion (WordPress Comments)</h2>
        <Comments for={item} />
      </section>
    </main>
  );
}
