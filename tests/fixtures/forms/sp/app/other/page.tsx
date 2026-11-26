import { Link } from "spacepress/server/app";

export default function Other() {
  return (
    <main>
      <h1 className="other-page">Another page</h1>
      <Link href="/" prefetch>Form</Link>
      <Link href="/bare" prefetch>Bare template</Link>
    </main>
  );
}
