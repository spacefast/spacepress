import { Link } from "spacepress/app";

// Links to public files keep their paths, though the root `[slug]` route matches them too; a link to
// a page is written at the page's one address.
export default function About() {
  return (
    <>
      <h1>About</h1>
      <Link href="/logo.svg" className="file">Logo</Link>
      <Link href="/files/blog.json" className="nested">Data</Link>
      <Link href="/about" className="page">About</Link>
    </>
  );
}
