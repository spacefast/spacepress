import type { PageProps, StaticParams } from "first/app";

export const prerender = true;

export async function staticParams(): Promise<StaticParams<"tags/[tag]">> {
  return ["field", "lab notes"].map((tag) => ({ tag }));
}

export default function Tag({ params }: PageProps<"tags/[tag]">) {
  return <h1 className="tag">{params.tag}</h1>;
}
