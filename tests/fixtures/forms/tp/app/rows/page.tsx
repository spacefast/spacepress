import { entries } from "typedpress:db";
import { Live, useFormState } from "typedpress/app";
import { rename } from "../../server";

// A form per row for one action, each filled from what is stored: the state of a submit comes back
// on the row that posted, and after a success each row shows the stored name.
export default async function Rows() {
  const renamed = useFormState(rename);
  const all = await entries.list({ orderBy: { id: "asc" }, limit: 3 });
  const total = await entries.count();
  return (
    <main>
      <Live id="count"><p className="count">{total} rows</p></Live>
      {renamed.result ? <p className="renamed" role="status">Renamed {renamed.result.name} ({renamed.result.tags}; {renamed.result.size})</p> : null}
      {renamed.error ? <p className="rename-error">{renamed.error.message}</p> : null}
      {all.map((row) => (
        <form action={rename} className={`row row-${row.id}`} key={row.id}>
          <input type="hidden" name="id" value={String(row.id)} />
          <input name="name" defaultValue={row.name} />
          <label><input type="checkbox" name="tags" value="red" /> Red</label>
          <label><input type="checkbox" name="tags" value="blue" /> Blue</label>
          <label><input type="radio" name="size" value="s" /> S</label>
          <label><input type="radio" name="size" value="m" defaultChecked /> M</label>
          <button type="button" name="preview">Preview</button>
          <button>Rename</button>
        </form>
      ))}
    </main>
  );
}
