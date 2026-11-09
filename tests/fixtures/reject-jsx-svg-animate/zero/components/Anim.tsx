export function Anim({ u }: { u: string }) {
  return <svg><a><animate attributeName="href" values={u} /></a></svg>;
}
