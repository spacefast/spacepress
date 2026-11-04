import { link, type Metadata } from "@spacefast/zero-pages";

export const metadata = { title: "Not found", robots: { index: false } } satisfies Metadata;

export default function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p>That page does not exist, or it is not published yet. <a href={link("/notes")}>Browse the notes.</a></p>
    </>
  );
}
