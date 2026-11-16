import { entries } from "typedpress:db";
import { useFormState } from "typedpress/app";
import { close } from "../../server";

// A form whose button the server renders disabled once the poll is closed: the swap must keep it so.
export default async function Poll() {
  const closed = useFormState(close);
  const all = await entries.list({ where: { name: "closed" }, limit: 1 });
  const isClosed = all.length > 0;
  return (
    <main>
      {closed.result ? <p className="closed" role="status">The poll is closed.</p> : null}
      <form action={close} className="close">
        <button disabled={isClosed}>Close the poll</button>
      </form>
    </main>
  );
}
