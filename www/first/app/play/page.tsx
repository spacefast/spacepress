// The playground. /play?example=pantry&file=first.config.ts opens an example at a file;
// /play?s=<key> opens an edit someone saved with Share (the `shares` table, first/server.ts).
import { text } from "first";
import type { PageProps } from "first/app";
import { shares } from "first:db";

export const search = { s: text().max(12).optional() };

export const metadata = {
  title: "Playground",
  description: "Edit a TypedPress app and build it in your browser. See the PHP, SQL and types the build writes, then run the app in WordPress.",
  scripts: ["/site.js"],
};

export default async function Playground({ search }: PageProps<"play">) {
  // Read as the system: visitors may not list saved edits, only open one by its key.
  const found = search.s ? await shares.system.list({ where: { key: search.s }, limit: 1 }) : [];
  const shared = found[0];
  return (
    <main className="playpage">
      <h1>Playground</h1>
      <p className="lede">Pick an app, change its code and it is built in your browser by the same compiler the command line uses. Then run your version in WordPress, also in your browser. Share saves your edit on this site and gives you a link to it.</p>
      <div className="note">These are the example apps as they are in the code today, so they use the current names: <code>first.config.ts</code>, <code>first/</code>, <code>action()</code>. The guide describes the names they are moving to.</div>
      {search.s && !shared && <p className="note">No saved edit has the key <code>{search.s}</code>. This is the app as it ships.</p>}
      <tp-play example={shared ? shared.example : "full-site"} shared={shared ? JSON.stringify(shared.files) : undefined} picker="" share="" open="" />
    </main>
  );
}
