import { TaskList } from "../components/TaskList";

export const metadata = { title: "Tasks" };

// A page is rendered by WordPress, in PHP. The list in it stays live in the browser.
export default function Home() {
  return (
    <main style={{ font: "18px/1.6 system-ui", maxWidth: "34rem", margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Tasks</h1>
      <TaskList />
      <p><a href="wp-admin/new/">Open the admin</a></p>
    </main>
  );
}
