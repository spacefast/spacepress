function Wrap({ children }: { children: { title: string } }) {
  return <p>{children.title}</p>;
}

export function Page() {
  return <Wrap>{{ title: "x" }}</Wrap>;
}
