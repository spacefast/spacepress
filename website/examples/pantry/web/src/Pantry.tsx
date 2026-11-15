import { useQuery, useMutation } from "@typedpress/client/react";
import { tp } from "./tp";

export function Pantry() {
  // A query by its export name. It stays current: a write that changes it refreshes it.
  const soon = useQuery(tp.expiringSoon, { days: 3 });

  // A kind read, and a mutation that shows its result before the server answers.
  const everything = tp.items.list({ orderBy: { name: "asc" } });
  const items = useQuery(everything);
  const consume = useMutation((itemId: number) => tp.consume({ itemId }), {
    optimistic: (apply, itemId) =>
      apply(everything, (rows) => rows.map((row) =>
        row.id === itemId ? { ...row, quantity: Math.max(0, row.quantity - 1) } : row)),
  });

  if (items.loading) return <p>Loading…</p>;
  if (items.error) return <button onClick={() => tp.auth.signIn()}>Sign in</button>;

  return (
    <main>
      <h2>Use soon</h2>
      <ul>
        {soon.data?.map((item) => <li key={item.name}>{item.name}, {item.where}, by {item.expiresOn}</li>)}
      </ul>

      <h2>Everything</h2>
      <ul>
        {items.data.map((item) => (
          <li key={item.id}>
            {item.name}: {item.quantity} {item.unit}{" "}
            <button disabled={consume.pending} onClick={() => consume.mutate(item.id)}>Use one</button>
          </li>
        ))}
      </ul>
      {consume.error && <p role="alert">{consume.error.message}</p>}
    </main>
  );
}
