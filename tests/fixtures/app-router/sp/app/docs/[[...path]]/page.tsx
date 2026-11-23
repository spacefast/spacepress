import type { PageProps } from "spacepress/app";

export default function Docs({ params }: PageProps<"docs/[[...path]]">) {
  return <p className="docs">{params.path.length === 0 ? "index" : params.path.join(" > ")}</p>;
}
