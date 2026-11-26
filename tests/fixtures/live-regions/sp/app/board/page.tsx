import { signatures } from "spacepress/server/db";
import { Live } from "spacepress/server/app";
import { Counter } from "../../components/Counter";

export default async function Board() {
  const all = await signatures.list({ orderBy: { id: "asc" } });
  return (
    <main>
      <Live id="board">
        <Counter />
        <input className="draft" />
        <ul>{all.map((s) => <li key={s.id} className="signature">{s.name}</li>)}</ul>
      </Live>
    </main>
  );
}
