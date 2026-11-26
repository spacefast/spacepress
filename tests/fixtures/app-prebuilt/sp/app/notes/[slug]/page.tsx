import type { PageProps } from "spacepress/app";

export const prerender = true;
export const metadata = ({ item }: PageProps<"notes/[slug]">) => ({ title: item.title });

export default function Note({ item }: PageProps<"notes/[slug]">) {
  return <article className="note"><h1>{item.title}</h1><p className="summary">{item.summary ?? ""}</p></article>;
}
