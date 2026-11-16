// /docs opens the first doc.
import { docs } from "typedpress:db";
import { redirect } from "typedpress/app";
import { nav } from "typedpress/content";

export const metadata = { title: "Docs" };

export default async function DocsHome() {
  const tree = await nav(docs);
  const first = tree[0];
  if (first) redirect(first.href);
  return (
    <main className="prose">
      <h1>Docs</h1>
      <p>No docs are on this site yet. They are the Markdown files in <code>content/docs/</code>; <code>typedpress sync</code> sends them here.</p>
    </main>
  );
}
