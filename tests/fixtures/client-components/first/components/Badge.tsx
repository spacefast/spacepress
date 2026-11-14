// A server component a client component renders (Switch.tsx), in a file that sorts before it:
// it compiles once, as a server component, whoever renders it first. Its own `on` is a prop,
// never the Switch's state of the same name, and its `let` stays an ordinary statement.
export function Badge({ on }: { on: boolean }) {
  let text = "fixed";
  if (on) {
    text = "fixed on";
  }
  return <em className="badge">{text}</em>;
}
