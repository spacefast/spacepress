import { notes } from "spacepress:db";
import { Live } from "spacepress/app";

export default async function Home() {
  const all = await notes.list({ orderBy: { id: "asc" } });
  return (
    <main>
      <h1>Notes</h1>
      <Live id="notes">
        <ul>{all.map((n) => <li key={n.id} className="note">{n.title}</li>)}</ul>
      </Live>
      <Live id="empty">
        <p>No reads here</p>
      </Live>
    </main>
  );
}
