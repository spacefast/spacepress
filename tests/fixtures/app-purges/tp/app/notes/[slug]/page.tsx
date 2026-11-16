import type { PageProps } from "typedpress/app";

export const prerender = true;

export default function Note({ item }: PageProps<"notes/[slug]">) {
  return <h1 className="note">{item.title}</h1>;
}
