import { db } from "first";

export const metadata = { title: "Tasks" };

// A page is rendered by WordPress, in PHP. Edit the heading and press Run in WordPress.
export default async function Home() {
  const tasks = await db.query.tasks.findMany({ orderBy: { id: "asc" } });
  return (
    <main style={{ font: "18px/1.6 system-ui", maxWidth: "34rem", margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Tasks</h1>
      <ul>
        {tasks.map((task) => <li>{task.done ? "✓ " : "○ "}{task.title}</li>)}
      </ul>
      <p>{tasks.length} tasks, served by WordPress.</p>
    </main>
  );
}
