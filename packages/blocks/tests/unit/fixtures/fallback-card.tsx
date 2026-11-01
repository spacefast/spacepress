/** A component whose classic-fallback element (a key after a spread) holds a value that is not content. */
export function FallbackCard(props: { when: Date }) {
  return <p {...{ class: "when" }} key="w">{props.when}</p>;
}
