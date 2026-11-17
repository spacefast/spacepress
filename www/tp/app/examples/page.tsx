// The examples, each with a link to its code on GitHub and its repository's stars. The rows are
// the `examples` table; the star counts are filled in by the `refreshStars` job. When they are
// more than a day old this page asks for a refresh on the job queue and shows what it has.
import { examples } from "typedpress:db";
import { jobs } from "typedpress";

export const metadata = { title: "Examples", description: "Whole apps to read, edit in the playground and copy." };

const DAY = 24 * 60 * 60 * 1000;

export default async function Examples() {
  const rows = await examples.list({ orderBy: { position: "asc" }, limit: 50 });
  const stale = rows.some((row) => !row.starsAt || Date.now() - new Date(row.starsAt).getTime() > DAY);
  if (stale) await jobs.refreshStars.enqueue({}, { key: "refresh-stars" });
  return (
    <main className="prose">
      <h1>Examples</h1>
      <p className="lede">Whole apps. Each one opens in the playground, where you can change it and run it in WordPress, and each links to its code.</p>
      {rows.length === 0 && <p>No examples are listed yet. An admin adds them in the <code>examples</code> table.</p>}
      <ul className="cards">
        {rows.map((row) => (
          <li key={row.id}>
            <h2>{row.title}</h2>
            <p>{row.summary}</p>
            <p className="links">
              <a href={`/play/?example=${row.name}`}>Open in the playground</a>
              <a href={`https://github.com/${row.repo}/tree/main/${row.path}`}>Code on GitHub</a>
              <span className="stars" title={row.starsAt ? `GitHub was asked on ${row.starsAt.slice(0, 10)}` : "GitHub has not been asked yet"}>{row.stars == null ? (row.starsAt ? "no public star count" : "stars not counted yet") : `★ ${row.stars}`}</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="cap">The same list as JSON: <a href="/api/examples.json">/api/examples.json</a>.</p>
    </main>
  );
}
