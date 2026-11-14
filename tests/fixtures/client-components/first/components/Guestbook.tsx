"use client";
import { useLive } from "first/client";

// A read the browser keeps current: the server answers it in the first render, and the page
// subscribes to it through the app's typed client.
export function Guestbook({ limit }: { limit: number }) {
  const signed = useLive("guestbook", { orderBy: { id: "asc" }, limit });
  return (
    <section className="guestbook" data-loading={signed.loading ? "yes" : "no"}>
      <ul>
        {(signed.data ?? []).map((row) => <li key={row.id} className="guest">{row.name}</li>)}
      </ul>
    </section>
  );
}
