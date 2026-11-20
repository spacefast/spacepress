import { db } from "typedpress";
import { Link, useFormState } from "typedpress/app";
import { greet } from "../actions";

export default async function Home() {
  const latest = await db.query.notes.findFirst({
    columns: { title: true, slug: true },
    orderBy: { publishedAt: "desc" },
  });
  // The action returns to this page with a result or a validation error.
  const state = useFormState(greet);
  return (
    <>
      <section className="hero">
        <h1>Make this site yours.</h1>
        <p>Edit <code>tp/app/page.tsx</code> and refresh this page to see your change.</p>
        <Link className="button" href="/notes">Browse the notes <span aria-hidden="true">→</span></Link>
        {latest && <p>Latest note: <Link href={`/notes/${latest.slug}`}>{latest.title}</Link></p>}
      </section>
      <section className="greeting">
        <h2>Say hello</h2>
        <form action={greet}>
          <label htmlFor="name">Your name</label>
          <div className="form-row">
            <input id="name" name="name" defaultValue={state.values.name ?? ""} required maxLength={60} />
            <button type="submit">Say hello</button>
          </div>
        </form>
        {state.result && <p role="status">{state.result.message}</p>}
        {state.error && <p role="alert">{state.error.fields.name ?? state.error.message}</p>}
      </section>
    </>
  );
}
