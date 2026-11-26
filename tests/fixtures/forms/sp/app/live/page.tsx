import { entries } from "spacepress/server/db";
import { Live, useFormState } from "spacepress/server/app";
import { sign } from "../../server";

// A `<Live>` list and a form that adds to it: a region update while the post is in flight must not
// undo the page the post comes back to.
export default async function Signing() {
  const signed = useFormState(sign);
  const all = await entries.list({ orderBy: { id: "asc" } });
  return (
    <main>
      <Live id="entries">
        <ul>{all.map((e) => <li key={e.id} className="entry">{e.name}</li>)}</ul>
      </Live>
      {signed.result ? <p className="signed">Signed {signed.result}</p> : null}
      <form action={sign} className="sign">
        <input name="name" />
        <button>Sign</button>
      </form>
    </main>
  );
}
