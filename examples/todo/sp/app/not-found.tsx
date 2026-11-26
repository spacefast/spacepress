import { Link } from "spacepress/app";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="auth-shell">
      <h1>Task not found</h1>
      <p>This task may have been moved to trash or belongs to another account.</p>
      <Link href="/" className="btn btn--primary">Back to workspace</Link>
    </main>
  );
}
