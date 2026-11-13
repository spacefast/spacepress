// A React frontend as an external site would write one: the generated client, its hooks entry
// point, and React from the app's own bundle. tests/wp/hooks.test.ts bundles and drives it.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "../app/first/_generated/client/index.ts";
import { createHooks } from "../app/first/_generated/client/react.ts";

const config = (window as unknown as { __hooks: { api: string; authorization: string; run: string; pollMs: number } }).__hooks;
const first = createClient({ url: config.api, headers: { Authorization: config.authorization }, realtime: { transport: false, pollMs: config.pollMs } });
const { useQuery, useMutation } = createHooks(React);
const prefix = `Hooks ${config.run}`;

function Notes() {
  const where = { body: { like: `${prefix}%` } };
  const notes = useQuery(first.guestNotes.list({ where, orderBy: { id: "asc" } }));
  const count = useQuery(first.guestNotes.count({ where }));
  const secrets = useQuery(first.signups.list());
  const off = useQuery(first.guestNotes.list({ where }), { enabled: false });
  const renders = React.useRef(0);
  renders.current++;

  const add = useMutation((body: string) => first.guestNotes.create({ body }), {
    optimistic: (apply, body) => apply(first.guestNotes.list({ where, orderBy: { id: "asc" } }), (rows) => [...rows, { id: -1, body: `${body} (saving)`, memberId: null }]),
  });
  // big_counts takes creates from editors only: this write is refused, and its optimistic row goes.
  const counts = useQuery(first.bigCounts.list({ where: { n: -9 } }));
  const refused = useMutation((n: number) => first.bigCounts.create({ n }), {
    optimistic: (apply, n) => apply(first.bigCounts.list({ where: { n: -9 } }), (rows) => [...rows, { id: -1, n }]),
  });

  return (
    <main>
      <p id="state">{notes.loading ? "loading" : notes.error ? `error ${notes.error.status}` : "ready"}</p>
      <ul id="notes">{notes.data?.map((note) => <li key={note.id}>{note.body}</li>)}</ul>
      <p id="count">{count.data ?? "…"}</p>
      <p id="secrets">{secrets.loading ? "loading" : secrets.error ? `error ${secrets.error.status} ${secrets.error.code}` : `rows ${secrets.data?.length}`}</p>
      <p id="off">{off.loading ? "loading" : off.data === undefined ? "off" : "on"}</p>
      <p id="renders">{renders.current}</p>
      <button id="add" onClick={() => void add.mutate(`${prefix} mine`)}>add</button>
      <p id="adding">{add.pending ? "pending" : "idle"}</p>
      <ul id="counts">{counts.data?.map((row) => <li key={row.id}>{row.n}</li>)}</ul>
      <p id="counts-state">{counts.loading ? "loading" : "ready"}</p>
      <button id="refuse" onClick={() => void refused.mutate(-9).catch(() => {})}>refuse</button>
      <p id="refused">{refused.error ? `error ${(refused.error as { status?: number }).status}` : refused.pending ? "pending" : "idle"}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Notes />);
