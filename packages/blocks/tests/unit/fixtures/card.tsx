/** A component whose own JSX has a mistake; the report names both places. */
export function Card(props: { title: string }) {
  return <section style={{ padding: 1 }}>{props.title}</section>;
}
