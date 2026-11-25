import { buckets, tasks } from "spacepress:db";
import { Comments, Content, Link, notFound, type PageProps } from "spacepress/app";
import { TaskCheckButton } from "../../../components/TaskCheckButton";
import { decodeWpText } from "../../../lib/todo";
import { completeAndStopRecurring, snoozeTask } from "../../../server";

export const guard = "authenticated";

export const metadata = ({ item }: PageProps<"tasks/[slug]">) => ({
  title: item ? item.title : "Task",
});

export default async function TaskDetailPage({ item }: PageProps<"tasks/[slug]">) {
  if (!item) notFound();

  const allBuckets = await buckets.system.list({ orderBy: { sortOrder: "asc" }, limit: 200 });
  const assignedBuckets = allBuckets.filter((b) => item.bucketIds.includes(b.id));
  const blocker = item.blockedBy ? await tasks.get(item.blockedBy) : null;
  const blocking = await tasks.list({
    where: { blockedBy: item.id, completedAt: { isNull: true } },
    limit: 50,
  });

  return (
    <main className="task-detail-page">
      <div>
        <Link href={`/?task=${item.id}`} className="sp-topbar__link">← Back to workspace</Link>
      </div>

      <article className="task-detail-card">
        <div className="task-row__top">
          <TaskCheckButton
            taskId={item.id}
            completed={item.completedAt !== null}
            label={item.completedAt ? `Reopen ${item.title}` : `Complete ${item.title}`}
          />
          <h1 className="todo-header__title">{item.title}</h1>
        </div>

        {item.notes && <p className="todo-header__subtitle">{item.notes}</p>}

        <div className="task-row__meta">
          {item.priority !== "none" && (
            <span className={`chip chip--priority-${item.priority}`}>{item.priority}</span>
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
            Edit in inspector
          </Link>
          {item.completedAt === null && item.recurringDays > 0 && (
            <form action={completeAndStopRecurring} className="inline-form">
              <input type="hidden" name="id" value={item.id} />
              <button className="btn btn--subtle btn--xs">Complete &amp; stop recurring</button>
            </form>
          )}
          {item.completedAt === null && (
            <form action={snoozeTask} className="inline-form">
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="days" value={1} />
              <button className="btn btn--subtle btn--xs">Snooze +1d</button>
            </form>
          )}
        </div>
      </article>

      <section className="inspector__comments" aria-label="Task notes and history">
        <h2>Notes &amp; History (WordPress Comments)</h2>
        <Comments for={item} />
      </section>
    </main>
  );
}
