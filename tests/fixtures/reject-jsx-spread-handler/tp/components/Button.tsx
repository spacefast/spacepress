export function Button({ q }: { q: string }) {
  return <button {...{ onClick: q }}>x</button>;
}
