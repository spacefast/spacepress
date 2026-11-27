import { Link } from "spacepress/app";

export default function Other() {
  return (
    <main>
      <h1 className="other-page">Another page</h1>
      <Link href="/" prefetch>Form</Link>
      <Link href="/bare" prefetch>Bare template</Link>
      {/* An id that isn't a CSS selector (it starts with a digit), for a fragment link to it. */}
      <p id="1note" className="note">A note far down the page.</p>
    </main>
  );
}
