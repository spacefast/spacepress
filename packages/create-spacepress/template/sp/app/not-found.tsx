import { Link } from "spacepress/app";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p><Link href="/notes">Browse the notes</Link> or <Link href="/">return home</Link>.</p>
    </>
  );
}
