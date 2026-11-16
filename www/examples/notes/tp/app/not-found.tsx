import { Link } from "typedpress/app";

export const metadata = { title: "Not found", robots: { index: false } };

export default function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p>That page does not exist, or it is not published yet. <Link href="/notes">Browse the notes.</Link></p>
    </>
  );
}
