import { Link, useFormState } from "spacepress/app";
import { members, subscribe, vote } from "../server";

export default function Page() {
  const state = useFormState(subscribe);
  const member = useFormState(members);
  const voted = useFormState(vote);
  return (
    <main>
      {state.result ? <p className="done">Subscribed {state.result.email} for {state.result.seats} (weekly: {String(state.result.weekly)})</p> : null}
      {state.error ? <p className="error" data-code={state.error.code}>{state.error.message}</p> : null}
      <form action={subscribe} className="subscribe">
        <input name="email" type="email" defaultValue={state.values.email ?? ""} />
        {state.error && state.error.fields.email ? <span className="field-error">{state.error.fields.email}</span> : null}
        <input name="seats" defaultValue={state.values.seats ?? "1"} />
        <input name="weekly" type="checkbox" />
        <input name="note" />
        <input name="password" type="password" defaultValue={state.values.password ?? ""} />
        <button>Subscribe</button>
      </form>
      {member.result ? <p className="member">{member.result}</p> : null}
      {member.error ? <p className="member-error" data-code={member.error.code}>{member.error.message}</p> : null}
      <form action={members} className="members"><input name="name" /><button>Join</button></form>
      {voted.result ? <p className="voted">Voted {voted.result}</p> : null}
      <form action={vote} id="vote" className="vote">
        <button name="choice" value="yes" className="yes">Yes</button>
        <button name="choice" value="maybe" className="maybe">Maybe</button>
      </form>
      <button form="vote" name="choice" value="no" className="outside">No</button>
      <Link href="/other" className="other">Other</Link>
    </main>
  );
}
